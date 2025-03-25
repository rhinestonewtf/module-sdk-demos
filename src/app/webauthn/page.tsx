"use client";
import { Button } from "@/components/Button";
import { getCount, getIncrementCalldata } from "@/components/Counter";
import Image from "next/image";
import { useCallback, useState } from "react";
import {
  toSafeSmartAccount,
  ToSafeSmartAccountReturnType,
} from "permissionless/accounts";
import { Chain, createPublicClient, http, Transport } from "viem";
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
import { baseSepolia } from "viem/chains";
import { getAccountNonce } from "permissionless/actions";
import { PublicKey } from "ox";
import { sign } from "ox/WebAuthnP256";
import { pimlicoBaseSepoliaUrl, pimlicoClient } from "@/utils/clients";
import { erc7579Actions } from "permissionless/actions/erc7579";
import { Footer } from "@/components/Footer";
import { getNonce } from "@/components/NonceManager";
import { toAccount } from "viem/accounts";

const appId = "webauthn";

export default function Home() {
  const [smartAccountClient, setSmartAccountClient] = useState<
    SmartAccountClient<Transport, Chain, ToSafeSmartAccountReturnType<"0.7">> &
      Erc7579Actions<ToSafeSmartAccountReturnType<"0.7">>
  >();
  const [credential, setCredential] = useState<P256Credential>(() =>
    JSON.parse(localStorage.getItem("credential") || "null"),
  );

  const [userOpLoading, setUserOpLoading] = useState(false);
  const [count, setCount] = useState<number>(0);

  const createSafe = useCallback(async (_credential: P256Credential) => {
    const publicClient = createPublicClient({
      chain: baseSepolia,
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
      chain: baseSepolia,
      userOperation: {
        estimateFeesPerGas: async () =>
          (await pimlicoClient.getUserOperationGasPrice()).fast,
      },
      bundlerTransport: http(pimlicoBaseSepoliaUrl),
    }).extend(erc7579Actions());

    setSmartAccountClient(_smartAccountClient as any); // eslint-disable-line
    // @ts-ignore
    setCount(await getCount({ publicClient, account: safeAccount.address }));
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

  const handleSendUserOp = useCallback(async () => {
    if (!smartAccountClient) {
      console.error("No smart account client");
      return;
    } else if (!credential) {
      console.error("No credential");
      return;
    }

    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(),
    });

    setUserOpLoading(true);

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
      calls: [getIncrementCalldata()],
      nonce,
      signature: getWebauthnValidatorMockSignature(),
    });

    const userOpHashToSign = getUserOperationHash({
      chainId: baseSepolia.id,
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

    setCount(
      await getCount({
        // @ts-ignore
        publicClient,
        account: smartAccountClient.account.address,
      }),
    );
    setUserOpLoading(false);
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
          <span className="text-lg font-bold">x Webauthn</span>
        </div>
        <ol className="list-inside list-decimal text-sm text-center sm:text-left font-[family-name:var(--font-geist-mono)]">
          <li className="mb-2">Create a Webauthn account.</li>
          <li className="mb-2">
            Use the webauthn module to send a UserOperation.
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
              <>Webauthn credential: {credential.id}</>
            )}
          </div>
        </div>

        <div className="flex gap-4 items-center flex-col sm:flex-row">
          <Button
            buttonText="Create Credential"
            onClick={handleCreateCredential}
          />
          <Button
            buttonText="Send UserOp"
            disabled={!smartAccountClient}
            onClick={handleSendUserOp}
            isLoading={userOpLoading}
          />
        </div>
      </main>
      <Footer count={count} appId={appId} />
    </div>
  );
}
