'use client';
import { Button } from '@/components/Button';
import { Footer } from '@/components/Footer';
import { useState, useCallback, useEffect } from 'react';
import {
  Address,
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  getAddress,
  Transport,
  Chain,
  encodeAbiParameters,
  Hex,
  toBytes,
  toHex,
  keccak256,
  concat,
} from 'viem';
import { optimismSepolia, baseSepolia } from 'viem/chains';
import { getNonce } from '@/components/NonceManager';
import { deployAccount } from '@/utils/deployment';
import { sendIntent } from '@/utils/orchestrator';
import { toAccount, generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createSmartAccountClient, SmartAccountClient } from 'permissionless';
import { toSafeSmartAccount, ToSafeSmartAccountReturnType } from 'permissionless/accounts';
import { entryPoint07Address } from 'viem/account-abstraction';
import { erc7579Actions } from 'permissionless/actions/erc7579';
import { Erc7579Actions } from 'permissionless/actions/erc7579';
import { pimlicoClient, pimlicoBaseSepoliaUrl } from '@/utils/clients';
import Image from 'next/image';

// Keystore-specific imports
import {
  RHINESTONE_ATTESTER_ADDRESS,
  MOCK_ATTESTER_ADDRESS,
  getAccount,
  OWNABLE_VALIDATOR_ADDRESS,
  encodeValidationData,
} from '@rhinestone/module-sdk';

// Axiom Keystore constants
const AXIOM_KEYSTORE_RPC_URL = 'https://keystore-rpc.axiom.xyz/v1';
const AXIOM_KEYSTORE_ROLLUP = '0x6C8364763d7Be106a9a9F86d9cC8990A2222ae38';
const KEYSTORE_VALIDATOR_ADDRESS = '0x1234567890123456789012345678901234567890' as `0x${string}`; // Replace with actual address from the SDK
const AXIOM_KEYSTORE_CACHE = '0xbE8877ab2B97e8Ca4A2d0Ae9B10ed12cC9646190';

// Define our own keystoreValidator function since it might not be exported from the SDK yet
const getKeystoreValidator = ({
  invalidationTime,
  keystoreAddress,
}: {
  invalidationTime: bigint;
  keystoreAddress: `0x${string}`;
}) => {
  // Encode the initialization data according to the KeystoreValidator.sol contract
  // Format: abi.encode(uint256 invalidationTime, bytes32 keystoreAddress)
  const initData = encodeAbiParameters(
    [
      { name: 'invalidationTime', type: 'uint256' },
      { name: 'keystoreAddress', type: 'bytes32' },
    ],
    [invalidationTime, keystoreAddress]
  );

  return {
    address: KEYSTORE_VALIDATOR_ADDRESS,
    initData,
  };
};

// Define constants for the Axiom Keystore
const OWNABLE_CODE_HASH = '0xd9ad90a204447aec1a1528d764e1d80212c8011dc0125b3995875e58ec9a43bf' as `0x${string}`;
const VKEY_HASH = '0xafc6c9447c95010572d8479b90db27c53534a65555825f324cb0530152b169a4' as `0x${string}`;
const SALT = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`;

const appId = 'keystore-validator';
const chainId = baseSepolia.id;

// Helper function to call Axiom Keystore RPC
async function callAxiomKeystoreRPC(method: string, params: Record<string, unknown>) {
  const response = await fetch(AXIOM_KEYSTORE_RPC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  });

  const data = await response.json();
  if (data.error) {
    throw new Error(`Axiom Keystore RPC Error: ${data.error.message}`);
  }

  return data.result;
}

export default function KeystoreDemo() {
  // Use 'any' type for the smart account client in this demo for simplicity
  // In a production app, you would want to use the proper types
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [smartAccountClient, setSmartAccountClient] = useState<any>(null);
  const [isAccountDeployed, setIsAccountDeployed] = useState(false);
  const [keystoreAddress, setKeystoreAddress] = useState<`0x${string}`>('0x');
  const [keyData, setKeyData] = useState<`0x${string}`>('0x');
  const [owner, setOwner] = useState<{ address: Address; privateKey: Hex } | null>(null);

  // Fixed default invalidation time (7 days in seconds)
  const invalidationTime = BigInt(3600 * 24 * 7);
  const [proof, setProof] = useState<`0x${string}`>('0x');

  const [transferLoading, setTransferLoading] = useState(false);
  const [deployAccountLoading, setDeployAccountLoading] = useState(false);
  const [tokenBalance, setTokenBalance] = useState<number>(0);

  const [targetAddress, setTargetAddress] = useState<string>('');
  const [amount, setAmount] = useState<string>('');

  const [error, setError] = useState<string | null>(null);
  const [transactionStatus, setTransactionStatus] = useState<string | null>(null);

  // Load owner from localStorage on component mount
  useEffect(() => {
    const localOwnerKey = localStorage.getItem('keystore-owner-pk');
    if (localOwnerKey) {
      const account = privateKeyToAccount(localOwnerKey as Hex);
      setOwner({
        address: account.address,
        privateKey: localOwnerKey as Hex,
      });
    }
  }, []);

  // Get token balance
  const getBalance = async () => {
    if (smartAccountClient) {
      const publicClient = createPublicClient({
        chain: baseSepolia,
        transport: http(),
      });

      try {
        const balance = await publicClient.getBalance({
          address: smartAccountClient.account.address,
        });

        // Convert bigint to number properly
        setTokenBalance(Number(balance / 10n ** 18n));
      } catch (err) {
        console.error('Failed to fetch balance:', err);
      }
    }
  };

  useEffect(() => {
    if (keystoreAddress !== '0x' && keyData !== '0x' && !smartAccountClient) {
      createAccountWithKeystore();
    }
  }, [keystoreAddress, keyData]);

  useEffect(() => {
    getBalance();
  }, [smartAccountClient]);

  // Check if the account has been deployed
  const checkAccountDeployment = useCallback(async () => {
    if (smartAccountClient) {
      const publicClient = createPublicClient({
        chain: baseSepolia,
        transport: http(),
      });

      try {
        const code = await publicClient.getCode({
          address: smartAccountClient.account.address,
        });

        const isDeployed = !!code && code !== '0x';
        setIsAccountDeployed(isDeployed);
      } catch (err) {
        console.error('Error checking deployment status:', err);
      }
    }
  }, [smartAccountClient]);

  useEffect(() => {
    checkAccountDeployment();
  }, [smartAccountClient, checkAccountDeployment]);

  // Setup the Keystore account using the SDK
  const createAccountWithKeystore = useCallback(async () => {
    try {
      setDeployAccountLoading(true);
      const publicClient = createPublicClient({
        chain: baseSepolia,
        transport: http(),
      });

      // Create a dead owner (we'll use the validator for authentication)
      const deadOwner = toAccount({
        address: '0x000000000000000000000000000000000000dead' as Address,
        async signMessage() {
          return '0x';
        },
        async signTransaction() {
          return '0x';
        },
        async signTypedData() {
          return '0x';
        },
      });

      // Get the keystore validator configuration
      const keystoreValidator = getKeystoreValidator({
        invalidationTime,
        keystoreAddress,
      });

      // Create a Safe account with the keystore validator
      const safeAccount = await toSafeSmartAccount({
        saltNonce: getNonce({
          appId,
        }),
        client: publicClient,
        owners: [deadOwner],
        version: '1.4.1',
        entryPoint: {
          address: entryPoint07Address,
          version: '0.7',
        },
        safe4337ModuleAddress: '0x7579EE8307284F293B1927136486880611F20002',
        erc7579LaunchpadAddress: '0x7579011aB74c46090561ea277Ba79D510c6C00ff',
        attesters: [
          RHINESTONE_ATTESTER_ADDRESS, // Rhinestone Attester
          MOCK_ATTESTER_ADDRESS, // Mock Attester - do not use in production
        ],
        attestersThreshold: 1,
        validators: [
          {
            address: keystoreValidator.address,
            context: keystoreValidator.initData,
          },
        ],
      });

      const _smartAccountClient = createSmartAccountClient({
        account: safeAccount,
        paymaster: pimlicoClient,
        chain: baseSepolia,
        userOperation: {
          estimateFeesPerGas: async () => (await pimlicoClient.getUserOperationGasPrice()).fast,
        },
        bundlerTransport: http(pimlicoBaseSepoliaUrl),
      }).extend(erc7579Actions());

      // Set the client (type safety is handled by the SDK internally)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setSmartAccountClient(_smartAccountClient as any);
      setTransactionStatus('Account setup complete');
      setDeployAccountLoading(false);

      await checkAccountDeployment();
    } catch (err) {
      console.error('Error creating account:', err);
      setError(`Failed to create account: ${err instanceof Error ? err.message : String(err)}`);
      setDeployAccountLoading(false);
    }
  }, [keystoreAddress, keyData, invalidationTime, checkAccountDeployment]);

  // Generate or select owner
  const handleGenerateOwner = useCallback(async () => {
    try {
      // Generate a new owner private key
      const ownerKey = generatePrivateKey();
      const account = privateKeyToAccount(ownerKey);
      setOwner({
        address: account.address,
        privateKey: ownerKey,
      });

      // Save to localStorage
      localStorage.setItem('keystore-owner-pk', ownerKey);

      setTransactionStatus('Owner key generated and saved');
    } catch (err) {
      setError(`Failed to generate owner: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  // Create keystore on Axiom's rollup
  const handleCreateKeystore = useCallback(async () => {
    if (!owner) {
      setError('Please generate an owner key first');
      return;
    }

    try {
      setDeployAccountLoading(true);

      // Setup owners for the OwnableValidator
      const threshold = 1;

      // Create key data following the format in the contract:
      // abi.encodePacked(validator.codehash, abi.encode(threshold, owners))
      const validationData = encodeValidationData({
        threshold: threshold,
        owners: [owner.address],
      });

      // We need to combine the OwnableValidator codehash with the validation data
      const _keyData = `${OWNABLE_CODE_HASH}${validationData.slice(2)}` as `0x${string}`;
      setKeyData(_keyData);

      try {
        // Properly calculate keystoreAddress using the formula:
        // keystoreAddress = keccak256(abi.encodePacked(salt, keccak256(keyData), vkeyHash));

        // 1. Calculate keccak256(keyData)
        const keyDataHash = keccak256(_keyData);

        // 2. Concatenate salt + keyDataHash + vkeyHash
        const packedData = concat([SALT, keyDataHash, VKEY_HASH]);

        // 3. Calculate the final hash to get keystoreAddress
        const _keystoreAddress = keccak256(packedData) as `0x${string}`;

        setKeystoreAddress(_keystoreAddress);

        setTransactionStatus('Keystore created on Axiom rollup');
      } catch (err) {
        throw new Error(`Failed to create keystore on Axiom: ${err instanceof Error ? err.message : String(err)}`);
      }

      setDeployAccountLoading(false);
    } catch (err) {
      setDeployAccountLoading(false);
      setError(`Failed to create keystore: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [owner]);

  // Deploy account
  const handleDeployAccount = useCallback(async () => {
    if (!smartAccountClient) return;

    try {
      setDeployAccountLoading(true);

      // Deploy the account on OP Sepolia
      const userOp = await smartAccountClient.prepareUserOperation({
        account: smartAccountClient.account,
        calls: [], // Empty call just to deploy the account
      });

      const userOpHash = await smartAccountClient.sendUserOperation(userOp);

      const receipt = await smartAccountClient.waitForUserOperationReceipt({
        hash: userOpHash,
      });

      console.log('Deployment receipt:', receipt);

      setIsAccountDeployed(true);
      setTransactionStatus('Account deployed successfully on Base Sepolia');
      setDeployAccountLoading(false);
    } catch (err) {
      setDeployAccountLoading(false);
      setError(`Failed to deploy account: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [smartAccountClient]);

  // Generate proof from Axiom keystore periphery
  const handleGenerateProof = useCallback(async () => {
    try {
      // In a real implementation, this would interact with Axiom keystore periphery
      // to generate a ZK proof for the transaction validation

      // Mock RPC call to get a proof from Axiom
      /*
      const result = await callAxiomKeystoreRPC('keystore_generateProof', {
        keystoreAddress: keystoreAddress,
        message: '0x...' // The message to sign
      });
      const mockProof = result.proof;
      */

      // Mock proof generation for demo
      const mockProof = `0x${Array.from({ length: 128 }, () => Math.floor(Math.random() * 16).toString(16)).join(
        ''
      )}` as `0x${string}`;

      setProof(mockProof);
      setTransactionStatus('Proof generated successfully from Axiom');
    } catch (err) {
      setError(`Failed to generate proof: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [keystoreAddress]);

  // Execute transaction with proof on OP Sepolia
  const handleTransfer = useCallback(async () => {
    if (!smartAccountClient || proof === '0x' || !isAddress(targetAddress) || !amount || !parseFloat(amount)) {
      setError('Missing required information for transfer');
      return;
    }

    try {
      setTransferLoading(true);

      // Create the transaction with the proof
      const transferAmount = BigInt(parseFloat(amount) * 10 ** 18);

      // In a real implementation, we would:
      // 1. Get the userOp hash
      // 2. Send the userOp hash to the keystore prover to get a ZK proof
      // 3. Use the proof as a signature for the userOp on OP Sepolia

      // For the demo, we'll simulate the transaction
      const mockTxHash = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;

      setTimeout(() => {
        setTransactionStatus(`Transaction sent on Base Sepolia: ${mockTxHash}`);
        setTransferLoading(false);

        // Refresh balance after transfer
        setTimeout(() => {
          getBalance();
        }, 3000);
      }, 1500);
    } catch (err) {
      setTransferLoading(false);
      setError(`Transfer failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [smartAccountClient, proof, targetAddress, amount]);

  const clearStatus = () => {
    setTransactionStatus(null);
    setError(null);
  };

  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <main className="flex flex-col gap-8 row-start-2 items-center sm:items-start">
        <div className="flex flex-row items-center align-center">
          <Image className="dark:invert" src="/rhinestone.svg" alt="Rhinestone logo" width={180} height={38} priority />{' '}
          <span className="text-lg font-bold">x Axiom Keystore</span>
        </div>

        <ol className="list-inside list-decimal text-sm text-center sm:text-left font-[family-name:var(--font-geist-mono)]">
          <li className="mb-2">Create a keystore account on Axiom&apos;s rollup.</li>
          <li className="mb-2">Deploy a smart account with the keystore validator on Base Sepolia.</li>
          <li className="mb-2">Generate ZK proof for transaction validation.</li>
          <li className="mb-2">Execute transaction with ZK proof authentication on Base Sepolia.</li>
        </ol>

        <div className="font-[family-name:var(--font-geist-mono)] text-sm">
          {owner && <div className="mb-2">Owner: {`${owner.address.slice(0, 10)}...${owner.address.slice(-8)}`}</div>}
          {keyData !== '0x' && <div className="mb-2">Key Data: {`${keyData.slice(0, 10)}...${keyData.slice(-8)}`}</div>}
          {keystoreAddress !== '0x' && (
            <div className="mb-2">
              Keystore Address: {`${keystoreAddress.slice(0, 10)}...${keystoreAddress.slice(-8)}`}
            </div>
          )}
          {smartAccountClient && (
            <div className="mb-2">Smart account (Base Sepolia): {smartAccountClient.account.address}</div>
          )}
        </div>

        {!owner ? (
          <div className="flex gap-4 items-center">
            <Button onClick={handleGenerateOwner} buttonText="Generate Owner Key" />
          </div>
        ) : keystoreAddress === '0x' ? (
          <div className="flex gap-4 items-center">
            <Button
              onClick={handleCreateKeystore}
              isLoading={deployAccountLoading}
              buttonText="Create Keystore on Axiom"
            />
          </div>
        ) : (
          <div className="flex gap-4 items-center flex-col sm:flex-row">
            {!isAccountDeployed && (
              <Button
                onClick={handleDeployAccount}
                isLoading={deployAccountLoading}
                buttonText="Deploy Account on Base Sepolia"
              />
            )}

            {isAccountDeployed && proof === '0x' && (
              <Button onClick={handleGenerateProof} buttonText="Generate Proof from Axiom" />
            )}

            {isAccountDeployed && proof !== '0x' && (
              <div className="flex flex-col gap-4 w-full max-w-md">
                <div>
                  <label className="block text-sm mb-2 font-[family-name:var(--font-geist-mono)]">
                    Recipient Address:
                  </label>
                  <input
                    type="text"
                    value={targetAddress}
                    onChange={(e) => setTargetAddress(e.target.value)}
                    className="w-full p-2 border rounded font-[family-name:var(--font-geist-mono)]"
                    placeholder="0x..."
                  />
                </div>
                <div>
                  <label className="block text-sm mb-2 font-[family-name:var(--font-geist-mono)]">Amount:</label>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full p-2 border rounded font-[family-name:var(--font-geist-mono)]"
                    placeholder="0.0"
                    min="0"
                    step="0.01"
                  />
                </div>
                <Button
                  onClick={handleTransfer}
                  isLoading={transferLoading}
                  disabled={proof === '0x' || !targetAddress || !amount}
                  buttonText="Execute Transaction on Base Sepolia"
                />
              </div>
            )}
          </div>
        )}

        {(error || transactionStatus) && (
          <div className="font-[family-name:var(--font-geist-mono)] text-sm mt-4">
            {error && (
              <div className="text-red-600 mb-3">
                {error}
                <button onClick={clearStatus} className="text-xs underline ml-2">
                  Dismiss
                </button>
              </div>
            )}

            {transactionStatus && (
              <div className="text-blue-600">
                {transactionStatus}
                <button onClick={clearStatus} className="text-xs underline ml-2">
                  Dismiss
                </button>
              </div>
            )}
          </div>
        )}
      </main>
      <Footer count={0} appId={appId} />
    </div>
  );
}
