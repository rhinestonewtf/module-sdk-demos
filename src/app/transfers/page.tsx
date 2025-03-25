"use client";
import { Button } from "@/components/Button";
import { getCount, getIncrementCalldata } from "@/components/Counter";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import {
  toSafeSmartAccount,
  ToSafeSmartAccountReturnType,
} from "permissionless/accounts";
import {
  Chain,
  createPublicClient,
  encodeFunctionData,
  encodePacked,
  erc20Abi,
  http,
  Transport,
  zeroAddress,
} from "viem";
import { Erc7579Actions } from "permissionless/actions/erc7579";
import { createSmartAccountClient, SmartAccountClient } from "permissionless";
import {
  createWebAuthnCredential,
  entryPoint07Address,
  getUserOperationHash,
  P256Credential,
} from "viem/account-abstraction";
import {
  RHINESTONE_ATTESTER_ADDRESS,
  MOCK_ATTESTER_ADDRESS,
  encodeValidatorNonce,
  getAccount,
  getWebauthnValidatorMockSignature,
  getWebAuthnValidator,
  WEBAUTHN_VALIDATOR_ADDRESS,
  getWebauthnValidatorSignature,
} from "@rhinestone/module-sdk";
import { arbitrumSepolia, baseSepolia } from "viem/chains";
import { getAccountNonce } from "permissionless/actions";
import { PublicKey } from "ox";
import { sign } from "ox/WebAuthnP256";
import { pimlicoClient } from "@/utils/clients";
import { erc7579Actions } from "permissionless/actions/erc7579";
import { Footer } from "@/components/Footer";
import { getNonce } from "@/components/NonceManager";
import { toAccount } from "viem/accounts";
import {
  BundleStatus,
  getOrchestrator,
  getOrderBundleHash,
  getTokenAddress,
  MetaIntent,
  PostOrderBundleResult,
  SignedMultiChainCompact,
} from "@rhinestone/orchestrator-sdk";
import { getBundle, sendIntent } from "@/components/orchestrator";

const appId = "webauthn";

const sourceChain = baseSepolia;
const targetChain = arbitrumSepolia;

export default function Home() {
  const [smartAccountClient, setSmartAccountClient] = useState<
    SmartAccountClient<Transport, Chain, ToSafeSmartAccountReturnType<"0.7">> &
      Erc7579Actions<ToSafeSmartAccountReturnType<"0.7">>
  >();
  const [credential, setCredential] = useState<P256Credential>(() =>
    JSON.parse(localStorage.getItem("credential") || "null"),
  );

  const [isAccountDeployed, setIsAccountDeployed] = useState(false);

  const [transferLoading, setTransferLoading] = useState(false);
  const [deployAccountLoading, setDeployAccountLoading] = useState(false);
  const [usdcBalance, setUsdcBalance] = useState<number>(0);

  const [targetAddress, setTargetAddress] = useState<string>("");
  const [amount, setAmount] = useState<string>("");

  const [error, setError] = useState<string | null>(null);

  const getBalance = async () => {
    if (smartAccountClient) {
      const publicClient = createPublicClient({
        chain: sourceChain,
        transport: http(),
      });

      const balance = await publicClient.readContract({
        address: getTokenAddress("USDC", sourceChain.id),
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [smartAccountClient.account.address],
      });

      setUsdcBalance(Number(balance) / 10 ** 6);
    }
  };

  useEffect(() => {
    getBalance();
  }, [smartAccountClient]);

  const createSafe = useCallback(async (_credential: P256Credential) => {
    const publicClient = createPublicClient({
      chain: sourceChain,
      transport: http(),
    });

    const { x, y, prefix } = PublicKey.from(_credential.publicKey);
    const webauthnValidator = getWebAuthnValidator({
      pubKey: { x, y, prefix },
      authenticatorId: _credential.id,
    });

    const deadOwner = toAccount({
      address: "0x000000000000000000000000000000000000dead",
      async signMessage() {
        return "0x";
      },
      async signTransaction() {
        return "0x";
      },
      async signTypedData() {
        return "0x";
      },
    });

    const safeAccount = await toSafeSmartAccount({
      saltNonce: getNonce({
        appId,
      }),
      client: publicClient,
      owners: [deadOwner],
      version: "1.4.1",
      entryPoint: {
        address: entryPoint07Address,
        version: "0.7",
      },
      safe4337ModuleAddress: "0x7579EE8307284F293B1927136486880611F20002",
      erc7579LaunchpadAddress: "0x7579011aB74c46090561ea277Ba79D510c6C00ff",
      attesters: [
        RHINESTONE_ATTESTER_ADDRESS, // Rhinestone Attester
        MOCK_ATTESTER_ADDRESS, // Mock Attester - do not use in production
      ],
      attestersThreshold: 1,
      validators: [
        {
          address: webauthnValidator.address,
          context: webauthnValidator.initData,
        },
      ],
    });
    const _smartAccountClient = createSmartAccountClient({
      account: safeAccount,
      paymaster: pimlicoClient,
      chain: sourceChain,
      userOperation: {
        estimateFeesPerGas: async () =>
          (await pimlicoClient.getUserOperationGasPrice()).fast,
      },
      bundlerTransport: http(
        `https://api.pimlico.io/v2/${sourceChain.id}/rpc?apikey=${process.env.NEXT_PUBLIC_PIMLICO_API_KEY}`,
      ),
    }).extend(erc7579Actions());

    const isDeployed =
      (await publicClient.getCode({
        address: safeAccount.address,
      })) !== "0x";
    setIsAccountDeployed(isDeployed);

    setSmartAccountClient(_smartAccountClient as any); // eslint-disable-line
  }, []);

  const handleCreateCredential = useCallback(async () => {
    let _credential;
    if (credential) {
      _credential = credential;
    } else {
      _credential = await createWebAuthnCredential({
        name: "Wallet Owner",
      });
    }
    setCredential(_credential);
    localStorage.setItem(
      "credential",
      JSON.stringify({
        id: _credential.id,
        publicKey: _credential.publicKey,
      }),
    );
    await createSafe(_credential);
  }, [createSafe, credential]);

  const handleDeployAccount = useCallback(async () => {
    if (!smartAccountClient) {
      console.error("No smart account client");
      return;
    } else if (!credential) {
      console.error("No credential");
      return;
    }

    if (isAccountDeployed) {
      console.error("Account already deployed");
      return;
    }

    setDeployAccountLoading(true);

    const publicClient = createPublicClient({
      chain: sourceChain,
      transport: http(),
    });

    const nonce = await getAccountNonce(publicClient, {
      address: smartAccountClient.account.address,
      entryPointAddress: entryPoint07Address,
      key: encodeValidatorNonce({
        account: getAccount({
          address: smartAccountClient.account.address,
          type: "safe",
        }),
        validator: WEBAUTHN_VALIDATOR_ADDRESS,
      }),
    });

    const userOperation = await smartAccountClient.prepareUserOperation({
      account: smartAccountClient.account,
      calls: [
        {
          to: zeroAddress,
          data: "0x",
        },
      ],
      nonce,
      signature: getWebauthnValidatorMockSignature(),
    });

    const userOpHashToSign = getUserOperationHash({
      chainId: sourceChain.id,
      entryPointAddress: entryPoint07Address,
      entryPointVersion: "0.7",
      userOperation,
    });

    const { metadata: webauthn, signature } = await sign({
      credentialId: credential.id,
      challenge: userOpHashToSign,
    });

    const encodedSignature = getWebauthnValidatorSignature({
      webauthn,
      signature,
      usePrecompiled: false,
    });

    userOperation.signature = encodedSignature;

    const userOpHash =
      await smartAccountClient.sendUserOperation(userOperation);

    const receipt = await smartAccountClient.waitForUserOperationReceipt({
      hash: userOpHash,
    });
    console.log("UserOp receipt: ", receipt);

    setDeployAccountLoading(false);
    setIsAccountDeployed(true);
  }, [credential, smartAccountClient, isAccountDeployed]);

  const handleTransfer = useCallback(async () => {
    setError(null);
    if (!smartAccountClient) {
      console.log("No smart account client");
      return;
    } else if (!credential) {
      console.log("No credential");
      return;
    }

    // console.log(targetAddress, amount);
    //
    // if (!targetAddress || !amount) {
    //   console.log(targetAddress, amount);
    //   console.log("Please enter a target address and amount");
    //   setError("Please enter a target address and amount");
    //   return;
    // } else if (Number(amount) > usdcBalance) {
    //   setError("Insufficient balance");
    //   return;
    // }

    const { orderPath, orderBundleHash } = await getBundle({
      targetChain,
      account: {
        address: smartAccountClient.account.address,
        initCode: "0x",
      },
      transfer: {
        amount: BigInt(1),
        recipient: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
      },
    });

    const { metadata: webauthn, signature } = await sign({
      credentialId: credential.id,
      challenge: orderBundleHash,
    });

    const encodedSignature = getWebauthnValidatorSignature({
      webauthn,
      signature,
      usePrecompiled: false,
    });

    const packedSig = encodePacked(
      ["address", "bytes"],
      [WEBAUTHN_VALIDATOR_ADDRESS, encodedSignature],
    );

    await sendIntent({
      orderPath,
      signature: packedSig,
      initCode: "0x",
    });
  }, [credential, smartAccountClient]);

  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <main className="flex flex-col gap-8 row-start-2 items-center sm:items-start">
        <div className="flex flex-row items-center align-center">
          <Image
            className="dark:invert"
            src="/rhinestone.svg"
            alt="Rhinestone logo"
            width={180}
            height={38}
            priority
          />{" "}
          <span className="text-lg font-bold">x Omni Account Transfers</span>
        </div>
        <ol className="list-inside list-decimal text-sm text-center sm:text-left font-[family-name:var(--font-geist-mono)]">
          <li className="mb-2">Create a Webauthn Omni Account.</li>
          <li className="mb-2">
            Fund and deploy the account on the source chain.
          </li>
          <li className="mb-2">
            Create an instant transfer on the target chain.
          </li>
        </ol>
        <div className="font-[family-name:var(--font-geist-mono)] text-sm">
          <div>
            {smartAccountClient && (
              <>Smart account: {smartAccountClient.account.address}</>
            )}
          </div>
          <div>
            {smartAccountClient && credential && (
              <>Balance on Base: {usdcBalance} USDC</>
            )}
          </div>
          <div>{isAccountDeployed && <>Account deployed on Base</>}</div>
        </div>

        <div className="flex gap-4 justify-center items-center flex-col sm:flex-row">
          <input
            className="bg-white rounded-2xl text-black px-4 py-1"
            placeholder="Target address"
            onChange={(e) => setTargetAddress(e.target.value)}
            value={targetAddress}
          />
          <input
            className="bg-white rounded-2xl text-black px-4 py-1"
            placeholder="Amount in USDC"
            onChange={(e) => setAmount(e.target.value)}
            value={amount}
            type="number"
          />
        </div>

        <div className="flex gap-4 items-center flex-col sm:flex-row">
          <Button
            buttonText="Create Credential"
            onClick={handleCreateCredential}
            disabled={!!smartAccountClient}
          />
          <Button
            buttonText="Deploy Account"
            disabled={!smartAccountClient || isAccountDeployed}
            onClick={handleDeployAccount}
            isLoading={deployAccountLoading}
          />

          <Button
            buttonText="Send Transfer"
            disabled={!isAccountDeployed}
            onClick={handleTransfer}
            isLoading={transferLoading}
          />
        </div>
        {error && (
          <div className="text-red-500 text-center flex-row items-center justify-center">
            {error}
          </div>
        )}
      </main>
      <Footer count={0} appId={appId} />
    </div>
  );
}
