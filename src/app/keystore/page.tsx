'use client';
import { Button } from '@/components/Button';
import { Footer } from '@/components/Footer';
import { useState, useCallback, useEffect } from 'react';
import {
  Address,
  createPublicClient,
  http,
  isAddress,
  getAddress,
  encodeAbiParameters,
  encodePacked,
  Hex,
  keccak256,
  concat,
  formatEther,
  zeroHash,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import { getNonce } from '@/components/NonceManager';
import { toAccount, generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createSmartAccountClient } from 'permissionless';
import { toSafeSmartAccount } from 'permissionless/accounts';
import { entryPoint07Address, getUserOperationHash } from 'viem/account-abstraction';
import { erc7579Actions } from 'permissionless/actions/erc7579';
import { pimlicoClient, pimlicoBaseSepoliaUrl } from '@/utils/clients';
import { getAccountNonce } from 'permissionless/actions';
import Image from 'next/image';
import React from 'react';
import { getRequiredPrefund } from 'permissionless';
import { KeystoreSibling, KeystoreLeaf, KeystoreProof, KeystoreProofResponse, KeystoreProofData } from './types';

// Keystore-specific imports
import {
  RHINESTONE_ATTESTER_ADDRESS,
  MOCK_ATTESTER_ADDRESS,
  getAccount,
  encodeValidationData,
  encodeValidatorNonce,
} from '@rhinestone/module-sdk';

// Axiom Keystore constants
const AXIOM_KEYSTORE_API_PROXY = '/api/axiom-keystore';
const KEYSTORE_VALIDATOR_ADDRESS = '0xcADf57c6343bAbe02E9C975BBaAeCa624a4e2f07' as `0x${string}`;

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

const appId = 'keystore-validator';

// Helper function to call Axiom Keystore API via our proxy API
async function callAxiomKeystoreAPI(address: `0x${string}`) {
  try {
    // Use the new GET endpoint with query parameters
    const response = await fetch(`${AXIOM_KEYSTORE_API_PROXY}?address=${address}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    if (data.error) {
      throw new Error(`Axiom Keystore API Error: ${data.error}`);
    }

    return data;
  } catch (error) {
    console.error('Error calling Axiom Keystore API:', error);
    throw error;
  }
}

// Function to get proof data
async function getAxiomProof(keystoreAddress: `0x${string}`, userSalt: `0x${string}`): Promise<KeystoreProofData> {
  try {
    console.log('Getting proof for keystore address:', keystoreAddress);

    // Get proof using our proxy API with the new REST endpoint
    const proofData = await callAxiomKeystoreAPI(keystoreAddress);

    // Check if we have a valid response
    if (proofData && proofData.state && proofData.proof) {
      // Extract data from the response
      const { state, proof } = proofData;

      // Construct isLeft bitmap - a bit packed form of the isLeft flags
      const isLeft = proof.siblings.reduce((acc: bigint, sibling: KeystoreSibling, index: number) => {
        return acc | (BigInt(sibling.isLeft ? 1 : 0) << BigInt(index));
      }, BigInt(0));

      // Extract the siblings hashes for the proof array
      const proofArray = proof.siblings.map((sibling: KeystoreSibling) => sibling.hash);

      // Get the leaf data
      const leaf = proof.leaf;

      // For exclusion proofs, construct exclusionExtraData
      // exclusionExtraData: abi.encodePacked(
      //    bytes1(keyPrefix),
      //    bytes32(key),
      //    salt,
      //    keccak256(abi.encode(bytes32(value)))
      // )

      // Calculate valueHash using abi.encode wrapped in keccak256
      let valueHash;
      console.log('Leaf value length:', leaf.value.length);
      if (leaf.value.length == 66) {
        // For 32 bytes data, use bytes32 type with packed encoding
        valueHash = keccak256(encodePacked(['bytes32'], [leaf.value]));
      } else if (leaf.value.length == 130) {
        // For 64 bytes data, use bytes type with packed encoding
        valueHash = keccak256(encodePacked(['bytes'], [leaf.value]));
      }

      // Construct exclusionExtraData
      const exclusionExtraData = concat([leaf.keyPrefix, leaf.key, userSalt, valueHash]) as `0x${string}`;

      return {
        isExclusion: proof.isExclusionProof,
        exclusionExtraData,
        vkeyHash: VKEY_HASH,
        keyData: '0x' as `0x${string}`,
        proof: proofArray,
        isLeft,
        nextDummyByte: leaf.nextKeyPrefix,
        nextImtKey: leaf.nextKey,
      };
    }

    // If we don't have valid data, throw an error that will be caught below
    throw new Error('Invalid or missing proof data from Axiom Keystore');
  } catch (error) {
    console.error('Error getting proof from Axiom:', error);
    throw error;
  }
}

// Helper function to create a mock signature in the correct format for KeystoreValidator
function getKeystoreValidatorMockSignature(
  keystoreAddress: `0x${string}`,
  keystoreKeyData: `0x${string}`,
  userSalt: `0x${string}`
): `0x${string}` {
  // Create a mock KeyMerkleProofData structure
  /*
  struct KeyMerkleProofData {
      bool isExclusion;
      bytes exclusionExtraData;
      bytes1 nextDummyByte;
      bytes32 nextImtKey;
      bytes32 vkeyHash;
      bytes keyData;
      bytes32[] proof;
      uint256 isLeft;
  }
  */
  // Values for constructing exclusionExtraData
  // exclusionExtraData: abi.encodePacked(
  //    bytes1(keyPrefix),
  //    bytes32(key),
  //    salt,
  //    keccak256(abi.encode(bytes32(valueBytes)))
  // )
  const keyPrefix = '0x01' as `0x${string}`;
  const key = '0x02856813f6b9bd77bea28521b0277bf2867e1a2358953d912fede9820369a9e5' as `0x${string}`;
  const dummyValueBytes32 = '0x0000000000000000000000000000000000000000000845951613fbb5ca776a2c' as `0x${string}`;

  // Calculate the value hash
  const valueHash = keccak256(encodeAbiParameters([{ type: 'bytes32' }], [dummyValueBytes32]));

  // Construct exclusionExtraData
  const exclusionExtraData = concat([keyPrefix, key, userSalt, valueHash]) as `0x${string}`;

  const mockProofData = {
    isExclusion: true,
    exclusionExtraData,
    nextDummyByte: '0x01' as `0x${string}`,
    nextImtKey: '0x078fd8980f317673830cdb6a2498d109c98b6fdc1ca9f4f773eb6aeedb66ac49' as `0x${string}`,
    vkeyHash: VKEY_HASH,
    keyData: keystoreKeyData,
    proof: [
      '0xaf005b651243ca95ea8580c7fb7129f35d5a81634578789b841658723f061518' as `0x${string}`,
      '0x96f023dc0bce011d48eb3e262f651e611c1946af7f8bf7362ce6d872a87dfeab' as `0x${string}`,
      '0x5737b7f9662dd2fed6073d06bdf4f10b47ec5ef196e77f20bc36bc7faae5b07a' as `0x${string}`,
      '0xeb5f0d5ddd45f007e487b9f2b28bcd111102cacafc942c4965e379583651977e' as `0x${string}`,
      '0xa1c2f4ae7e0433e044680c45617b32965d96080d22d7ca9e40d8dd6f98aea9c0' as `0x${string}`,
    ],
    isLeft: 1n,
  };

  // Create a mock signature
  const mockUserOpSig = `0x${Array.from({ length: 65 }, () => Math.floor(Math.random() * 16).toString(16)).join(
    ''
  )}` as `0x${string}`;

  // Encode in the correct format: abi.encode(keyDataMerkleProof, userOpSig)
  return encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'isExclusion', type: 'bool' },
          { name: 'exclusionExtraData', type: 'bytes' },
          { name: 'nextDummyByte', type: 'bytes1' },
          { name: 'nextImtKey', type: 'bytes32' },
          { name: 'vkeyHash', type: 'bytes32' },
          { name: 'keyData', type: 'bytes' },
          { name: 'proof', type: 'bytes32[]' },
          { name: 'isLeft', type: 'uint256' },
        ],
      },
      { type: 'bytes' },
    ],
    [mockProofData, mockUserOpSig]
  );
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
  const [salt, setSalt] = useState<`0x${string}`>('0x');

  // Fixed default invalidation time (7 days in seconds)
  const invalidationTime = BigInt(3600 * 24 * 7);
  const [proof, setProof] = useState<KeystoreProofData | null>(null);

  const [transferLoading, setTransferLoading] = useState(false);
  const [deployAccountLoading, setDeployAccountLoading] = useState(false);
  const [tokenBalance, setTokenBalance] = useState<number>(0);
  const [balanceLoading, setBalanceLoading] = useState(false);

  const [targetAddress, setTargetAddress] = useState<string>('');
  const [amount, setAmount] = useState<string>('');

  const [error, setError] = useState<string | null>(null);
  const [transactionStatus, setTransactionStatus] = useState<React.ReactNode | null>(null);

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
      setBalanceLoading(true);
      const publicClient = createPublicClient({
        chain: baseSepolia,
        transport: http(),
      });

      try {
        const balance = await publicClient.getBalance({
          address: smartAccountClient.account.address,
        });

        // Convert bigint to number properly
        setTokenBalance(Number(formatEther(balance)));
      } catch (err) {
        console.error('Failed to fetch balance:', err);
      } finally {
        setBalanceLoading(false);
      }
    }
  };

  // Fetch balance when the smart account client is set
  useEffect(() => {
    if (smartAccountClient) {
      getBalance();
    }
  }, [smartAccountClient]);

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

      console.log('Creating account with keystore...');
      console.log('Keystore Address:', keystoreAddress);

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

      console.log('Keystore Validator:', keystoreValidator.address);
      console.log('Keystore Init Data:', keystoreValidator.initData);

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

      console.log('Safe Account Address:', safeAccount.address);

      const _smartAccountClient = createSmartAccountClient({
        account: safeAccount,
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
        // Generate a fixed zero SALT
        const zeroSalt = zeroHash;
        setSalt(zeroSalt);

        // Properly calculate keystoreAddress using the formula:
        // keystoreAddress = keccak256(abi.encodePacked(salt, keccak256(keyData), vkeyHash));

        // 1. Calculate keccak256(keyData)
        const keyDataHash = keccak256(_keyData);

        // 2. Concatenate salt + keyDataHash + vkeyHash
        const packedData = concat([zeroSalt, keyDataHash, VKEY_HASH]);

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
    if (!smartAccountClient || !owner) {
      setError('Smart account client not initialized or owner not set. Please create keystore first.');
      return;
    }

    try {
      setDeployAccountLoading(true);
      console.log('------- DEPLOYING ACCOUNT -------');
      console.log('Account Address:', smartAccountClient.account.address);
      console.log('Chain ID:', baseSepolia.id);
      console.log('Keystore Address:', keystoreAddress);

      const publicClient = createPublicClient({
        chain: baseSepolia,
        transport: http(),
      });

      // Get the validator-specific nonce
      console.log('Getting validator-specific nonce...');
      const nonce = await getAccountNonce(publicClient, {
        address: smartAccountClient.account.address,
        entryPointAddress: entryPoint07Address,
        key: encodeValidatorNonce({
          account: getAccount({
            address: smartAccountClient.account.address,
            type: 'safe',
          }),
          validator: KEYSTORE_VALIDATOR_ADDRESS,
        }),
      });
      console.log('Nonce:', nonce);

      // Prepare the user operation with the specific nonce
      console.log('Preparing user operation with proper nonce...');
      const userOperation = await smartAccountClient.prepareUserOperation({
        account: smartAccountClient.account,
        calls: [
          {
            to: smartAccountClient.account.address,
            data: '0x',
            value: 0n,
          },
        ],
        preVerificationGas: 100000n, // TODO: Remove hardcoded value
      });

      console.log('User operation prepared successfully');

      // Get the hash that needs to be signed
      const userOpHashToSign = getUserOperationHash({
        chainId: baseSepolia.id,
        entryPointAddress: entryPoint07Address,
        entryPointVersion: '0.7',
        userOperation,
      });
      console.log('UserOp hash to sign:', userOpHashToSign);

      // Sign the hash with the owner's key
      const ownerAccount = privateKeyToAccount(owner.privateKey);
      const userOpSig = await ownerAccount.signMessage({
        message: { raw: userOpHashToSign },
      });
      console.log('Signature from owner key:', userOpSig);

      // Get a proper proof for the counterfactual keystore address
      setTransactionStatus('Getting proof from Axiom Keystore...');
      const keystoreProof = await getAxiomProof(keystoreAddress, salt);
      // Set keyData
      keystoreProof.keyData = keyData;

      // Encode the final signature by combining the proof and the signature
      const combinedSignature = encodeAbiParameters(
        [
          {
            type: 'tuple',
            components: [
              { name: 'isExclusion', type: 'bool' },
              { name: 'exclusionExtraData', type: 'bytes' },
              { name: 'nextDummyByte', type: 'bytes1' },
              { name: 'nextImtKey', type: 'bytes32' },
              { name: 'vkeyHash', type: 'bytes32' },
              { name: 'keyData', type: 'bytes' },
              { name: 'proof', type: 'bytes32[]' },
              { name: 'isLeft', type: 'uint256' },
            ],
          },
          { type: 'bytes' },
        ],
        [keystoreProof, userOpSig]
      );

      // Update the signature and nonce
      userOperation.signature = combinedSignature;
      userOperation.nonce = nonce;
      setTransactionStatus('Sending user operation for deployment...');

      // Check if the sender has enough funds
      const requiredPrefund = getRequiredPrefund({
        userOperation,
        entryPointVersion: '0.7',
      });

      const senderBalance = await publicClient.getBalance({
        address: userOperation.sender,
      });

      if (senderBalance < requiredPrefund) {
        console.log('Sender balance:', formatEther(senderBalance), 'ETH');
        console.log('Required prefund:', formatEther(requiredPrefund), 'ETH');
        console.log('Sender address:', userOperation.sender);
        throw new Error(
          `Account address does not have enough native tokens, required: ${formatEther(requiredPrefund)} ETH`
        );
      }

      // Send the user operation with the proper signature
      console.log('Sending user operation...');
      const userOpHash = await smartAccountClient.sendUserOperation(userOperation);
      console.log('UserOp hash:', userOpHash);

      console.log('Waiting for receipt...');
      setTransactionStatus('Waiting for deployment transaction receipt...');
      const receipt = await smartAccountClient.waitForUserOperationReceipt({
        hash: userOpHash,
      });

      console.log('Receipt received:', receipt);
      setIsAccountDeployed(true);
      setTransactionStatus(
        <span>
          Account deployed successfully on Base Sepolia{' '}
          <a
            href={`https://sepolia.basescan.org/tx/${receipt.receipt.transactionHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-500 underline"
          >
            View on BaseScan
          </a>
        </span>
      );

      setDeployAccountLoading(false);
    } catch (err) {
      console.error('Deployment error:', err);
      setDeployAccountLoading(false);
      setError(`Failed to deploy account: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [smartAccountClient, owner, keystoreAddress, keyData, salt]);

  // Generate proof from Axiom keystore periphery
  const handleGenerateProof = useCallback(async () => {
    try {
      setTransactionStatus('Generating proof from Axiom Keystore...');

      if (!keystoreAddress || keystoreAddress === '0x') {
        throw new Error('Keystore address not set');
      }

      // Get proof data formatted for the KeystoreValidator - now directly returns KeystoreProofData
      const keystoreProof = await getAxiomProof(keystoreAddress, salt);
      console.log('Keystore proof:', keystoreProof);

      // Set keyData on the proof to ensure it has the correct value
      keystoreProof.keyData = keyData;

      // Store the proof object directly
      setProof(keystoreProof);

      setTransactionStatus('Proof generated successfully from Axiom');

      // Refresh balance after generating proof
      getBalance();
    } catch (err) {
      setError(`Failed to generate proof: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [keystoreAddress, keyData, salt]);

  // Execute transaction with proof on Base Sepolia
  const handleTransfer = useCallback(async () => {
    if (!smartAccountClient || !proof || !isAddress(targetAddress) || !amount || !parseFloat(amount) || !owner) {
      setError('Missing required information for transfer or owner not set');
      return;
    }

    setTransferLoading(true);
    setTransactionStatus('Preparing transaction with Axiom proof...');
    try {
      // Create the transaction with the proof
      const transferAmount = BigInt(parseFloat(amount) * 10 ** 18);

      // Get validator-specific nonce for the keystore validator
      const publicClient = createPublicClient({
        chain: baseSepolia,
        transport: http(),
      });

      console.log('Getting validator-specific nonce...');

      const nonce = await getAccountNonce(publicClient, {
        address: smartAccountClient.account.address,
        entryPointAddress: entryPoint07Address,
        key: encodeValidatorNonce({
          account: getAccount({
            address: smartAccountClient.account.address,
            type: 'safe',
          }),
          validator: KEYSTORE_VALIDATOR_ADDRESS,
        }),
      });

      console.log('Nonce:', nonce);

      // Prepare user operation for the transfer
      const userOperation = await smartAccountClient.prepareUserOperation({
        account: smartAccountClient.account,
        calls: [
          {
            to: getAddress(targetAddress),
            data: '0x',
            value: transferAmount,
          },
        ],
        preVerificationGas: 100000n, // TODO: Remove hardcoded value
        verificationGasLimit: 100000n, // TODO: Remove hardcoded value
      });

      console.log('User operation prepared successfully');

      // Get the hash that needs to be signed by the owner's private key
      const userOpHashToSign = getUserOperationHash({
        chainId: baseSepolia.id,
        entryPointAddress: entryPoint07Address,
        entryPointVersion: '0.7',
        userOperation,
      });

      console.log('UserOp hash to sign:', userOpHashToSign);

      // Sign the userOpHash with the owner's private key
      // This is what would happen in a real scenario - the hash is signed by the key
      // represented in the Axiom keystore
      const ownerAccount = privateKeyToAccount(owner.privateKey);
      const userOpSig = await ownerAccount.signMessage({
        message: { raw: userOpHashToSign },
      });

      console.log('Signature from owner key:', userOpSig);

      // Encode the final signature by combining the proof data and signature
      // bytes memory sig = abi.encode(keyDataMerkleProof, userOpSig);
      const combinedSignature = encodeAbiParameters(
        [
          {
            type: 'tuple',
            components: [
              { name: 'isExclusion', type: 'bool' },
              { name: 'exclusionExtraData', type: 'bytes' },
              { name: 'nextDummyByte', type: 'bytes1' },
              { name: 'nextImtKey', type: 'bytes32' },
              { name: 'vkeyHash', type: 'bytes32' },
              { name: 'keyData', type: 'bytes' },
              { name: 'proof', type: 'bytes32[]' },
              { name: 'isLeft', type: 'uint256' },
            ],
          },
          { type: 'bytes' },
        ],
        [proof, userOpSig]
      );

      // Update the signature and nonce
      userOperation.signature = combinedSignature;
      userOperation.nonce = nonce;

      setTransactionStatus('Sending transaction with Axiom proof...');

      // Check if the sender has enough funds
      const requiredPrefund = getRequiredPrefund({
        userOperation,
        entryPointVersion: '0.7',
      });

      const senderBalance = await publicClient.getBalance({
        address: userOperation.sender,
      });

      if (senderBalance < requiredPrefund) {
        console.log('Sender balance:', formatEther(senderBalance), 'ETH');
        console.log('Required prefund:', formatEther(requiredPrefund), 'ETH');
        console.log('Sender address:', userOperation.sender);
        throw new Error(
          `Account address does not have enough native tokens, required: ${formatEther(requiredPrefund)} ETH`
        );
      }

      // Send the user operation
      const userOpHash = await smartAccountClient.sendUserOperation(userOperation);
      console.log('UserOp hash:', userOpHash);

      setTransactionStatus('Waiting for transaction receipt...');

      const receipt = await smartAccountClient.waitForUserOperationReceipt({
        hash: userOpHash,
      });

      console.log('Receipt received:', receipt);
      setTransactionStatus(
        <span>
          Transaction successful!{' '}
          <a
            href={`https://sepolia.basescan.org/tx/${receipt.receipt.transactionHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-500 underline"
          >
            View on BaseScan
          </a>
        </span>
      );

      // Refresh balance after transfer
      setTimeout(() => {
        getBalance();
      }, 3000);
    } catch (err) {
      console.error('UserOp error:', err);
      setError(`Transaction failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    setTransferLoading(false);
  }, [smartAccountClient, proof, targetAddress, amount, keystoreAddress, keyData, salt]);

  // After transaction completes, refresh balance
  useEffect(() => {
    // Check if transaction was successful by converting to string and checking content
    const statusText = String(transactionStatus || '');
    if (statusText.includes('Transaction successful!')) {
      getBalance();
    }
  }, [transactionStatus]);

  const clearStatus = () => {
    setTransactionStatus(null);
    setError(null);
  };

  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <main className="flex flex-col gap-8 row-start-2 items-center sm:items-start">
        <div className="flex flex-row items-center align-center">
          <Image className="dark:invert" src="/rhinestone.svg" alt="Rhinestone logo" width={180} height={38} priority />{' '}
          <span className="text-lg font-bold">
            x{' '}
            <a
              href="https://keystore-docs.axiom.xyz/introduction"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              Axiom Keystore
            </a>
          </span>
        </div>

        <ol className="list-inside list-decimal text-sm text-center sm:text-left font-[family-name:var(--font-geist-mono)]">
          <li className="mb-2"> Counterfactually create a keystore account on Axiom&apos;s rollup.</li>
          <li className="mb-2">
            Prepare userOp to deploy a smart account with the Keystore Validator on Base Sepolia.
          </li>
          <li className="mb-2">Fetch proof from the Axiom Rollup.</li>
          <li className="mb-2">Execute userOp using Axiom rollup proof.</li>
          <li className="mb-2">Repeat steps 3 and 4 for any new transaction.</li>
        </ol>

        <div className="font-[family-name:var(--font-geist-mono)] text-sm break-all">
          {owner && <div className="mb-2">Owner: {owner.address}</div>}
          {keyData !== '0x' && <div className="mb-2">Key Data: {keyData}</div>}
          {salt !== '0x' && <div className="mb-2">Salt: {salt}</div>}
          {keystoreAddress !== '0x' && <div className="mb-2">Keystore Address: {keystoreAddress}</div>}
          {smartAccountClient && (
            <>
              <div className="mb-2">Safe7579 Address: {smartAccountClient.account.address}</div>
              <div className="mb-2">Account deployed: {isAccountDeployed ? 'Yes' : 'No'}</div>
              <div className="mb-2">Chain ID: {baseSepolia.id}</div>
              {proof && <div className="mb-2">Proof: Loaded from Axiom</div>}
            </>
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

            {isAccountDeployed && !proof && (
              <Button onClick={handleGenerateProof} buttonText="Generate Proof from Axiom for new Transaction" />
            )}

            {isAccountDeployed && proof && (
              <div className="flex flex-col gap-4 w-full max-w-md">
                <div>
                  <label className="block text-sm mb-2 font-[family-name:var(--font-geist-mono)]">
                    Recipient Address:
                  </label>
                  <input
                    type="text"
                    value={targetAddress}
                    onChange={(e) => setTargetAddress(e.target.value)}
                    className="w-full p-2 border rounded font-[family-name:var(--font-geist-mono)] bg-white text-black dark:bg-gray-800 dark:text-white"
                    placeholder="0x..."
                  />
                </div>
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="block text-sm font-[family-name:var(--font-geist-mono)]">Amount:</label>
                    <div className="text-sm font-[family-name:var(--font-geist-mono)] flex items-center">
                      Balance:{' '}
                      {balanceLoading ? (
                        <span className="inline-block ml-1 animate-pulse">Loading...</span>
                      ) : (
                        <span className="inline-block ml-1">{tokenBalance.toFixed(4)} ETH</span>
                      )}
                      <button
                        onClick={getBalance}
                        className="ml-2 p-1 text-xs bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 rounded"
                        title="Refresh balance"
                      >
                        🔄
                      </button>
                      <button
                        onClick={() => {
                          // Set max amount, keeping 0.01 ETH for gas
                          const maxAmount = Math.max(0, tokenBalance - 0.01);
                          setAmount(maxAmount > 0 ? maxAmount.toString() : '0');
                        }}
                        className="ml-2 px-2 py-1 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded"
                        disabled={balanceLoading || tokenBalance <= 0}
                      >
                        Send Max
                      </button>
                    </div>
                  </div>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full p-2 border rounded font-[family-name:var(--font-geist-mono)] bg-white text-black dark:bg-gray-800 dark:text-white"
                    placeholder="0.0"
                    min="0"
                    step="0.001"
                    max={tokenBalance.toString()}
                  />
                  {parseFloat(amount) > tokenBalance && (
                    <p className="text-red-500 text-sm mt-1">Amount exceeds balance</p>
                  )}
                </div>
                <Button
                  onClick={handleTransfer}
                  isLoading={transferLoading}
                  disabled={
                    !targetAddress ||
                    !amount ||
                    parseFloat(amount) <= 0 ||
                    parseFloat(amount) > tokenBalance ||
                    balanceLoading
                  }
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
