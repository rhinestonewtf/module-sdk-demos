"use client";
import { Button } from "@/components/Button";
import { Connector } from "@/components/Connector";
import {
  CounterRef,
  getCount,
  getIncrementCalldata,
} from "@/components/Counter";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import {
  ToKernelSmartAccountReturnType,
  toSafeSmartAccount,
  ToSafeSmartAccountReturnType,
} from "permissionless/accounts";
import { Chain, encodeAbiParameters, http, Transport } from "viem";
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
  getOwnableValidator,
  encodeValidatorNonce,
  getAccount,
  getWebauthnValidatorMockSignature,
  getWebAuthnValidator,
  WEBAUTHN_VALIDATOR_ADDRESS,
} from "@rhinestone/module-sdk";
import { baseSepolia } from "viem/chains";
import { getAccountNonce } from "permissionless/actions";
import { parsePublicKey, parseSignature, sign } from "webauthn-p256";
import { pimlicoBaseSepoliaUrl, pimlicoClient } from "@/utils/clients";
import { erc7579Actions } from "permissionless/actions/erc7579";
import { Footer } from "@/components/Footer";
import { getNonce } from "@/components/NonceManager";

export default function Home() {
  const account = useAccount();
  const publicClient = usePublicClient();
  const walletClient = useWalletClient();

  const [smartAccountClient, setSmartAccountClient] = useState<
    SmartAccountClient<Transport, Chain, ToSafeSmartAccountReturnType<"0.7">> &
      Erc7579Actions<ToKernelSmartAccountReturnType<"0.7">>
  >();
  const [credential, setCredential] = useState<P256Credential>(() =>
    JSON.parse(localStorage.getItem("credential") || "null"),
  );
  const [validatorIsInstalled, setValidatorIsInstalled] = useState(false);

  const [validatorInstallationLoading, setValidatorInstallationLoading] =
    useState(false);
  const [userOpLoading, setUserOpLoading] = useState(false);
  const [count, setCount] = useState<number>(0);

  const createSafe = useCallback(async () => {
    const owner = account.address;
    const walletAccount = walletClient.data;
    if (!owner) {
      console.error("No owner");
      return;
    } else if (!walletAccount) {
      console.error("No wallet account");
      return;
    }

    const ownableValidator = getOwnableValidator({
      owners: [owner],
      threshold: 1,
    });

    const safeAccount = await toSafeSmartAccount({
      saltNonce: getNonce(),
      client: publicClient,
      owners: [walletAccount],
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
          address: ownableValidator.address,
          context: ownableValidator.initData,
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

    setSmartAccountClient(_smartAccountClient as any);
    setCount(await getCount({ publicClient, account: safeAccount.address }));
  }, [account, publicClient, walletClient]);

  const handleCreateCredential = useCallback(async () => {
    await createSafe();
    if (credential) return;
    const _credential = await createWebAuthnCredential({
      name: "Wallet Owner",
    });
    localStorage.setItem("credential", JSON.stringify(_credential));
    setCredential(_credential);
  }, [createSafe]);

  const handleInstallModule = useCallback(async () => {
    if (!smartAccountClient) {
      console.error("No smart account client");
      return;
    } else if (!credential) {
      console.error("No credential");
      return;
    }

    const { x, y, prefix } = parsePublicKey(credential.publicKey);
    const validator = getWebAuthnValidator({
      pubKey: { x, y, prefix },
      authenticatorId: credential.id,
    });

    const isInstalled = false; //await smartAccountClient.isModuleInstalled(validator);
    console.log("Is Installed:", isInstalled);

    if (isInstalled) {
      console.log("Module already installed");
      return;
    }
    const installOp = await smartAccountClient.installModule(validator);

    setValidatorInstallationLoading(true);

    const receipt = await smartAccountClient.waitForUserOperationReceipt({
      hash: installOp,
    });
    console.log("receipt", receipt);

    setValidatorInstallationLoading(false);
  }, [credential, smartAccountClient]);

  const handleSendUserOp = useCallback(async () => {
    if (!smartAccountClient) {
      console.error("No smart account client");
      return;
    } else if (!credential) {
      console.error("No credential");
      return;
    }

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

    const cred = await sign({
      credentialId: credential.id,
      hash: userOpHashToSign,
    });

    const { r, s } = parseSignature(cred.signature);

    // todo: use module sdk helper
    const encodedSignature = encodeAbiParameters(
      [
        { name: "authenticatorData", type: "bytes" },
        { name: "clientDataJSON", type: "string" },
        { name: "responseTypeLocation", type: "uint256" },
        { name: "r", type: "uint256" },
        { name: "s", type: "uint256" },
        { name: "usePrecompiled", type: "bool" },
      ],
      [
        cred.webauthn.authenticatorData,
        cred.webauthn.clientDataJSON,
        BigInt(cred.webauthn.typeIndex),
        BigInt(r),
        BigInt(s),
        false,
      ],
    );

    userOperation.signature = encodedSignature;

    const userOpHash =
      await smartAccountClient.sendUserOperation(userOperation);

    setUserOpLoading(true);

    const receipt = await smartAccountClient.waitForUserOperationReceipt({
      hash: userOpHash,
    });
    console.log("UserOp receipt: ", receipt);

    setCount(
      await getCount({
        publicClient,
        account: smartAccountClient.account.address,
      }),
    );
    setUserOpLoading(false);
  }, [credential, publicClient, smartAccountClient]);

  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <main className="flex flex-col gap-8 row-start-2 items-center sm:items-start">
        <Connector />
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
          <li className="mb-2">Connect your EOA.</li>
          <li className="mb-2">Create a Webauthn credential.</li>
          <li className="mb-2">Install the webauthn module.</li>
          <li className="mb-2">
            Use the webauthn module to send a UserOperation.
          </li>
        </ol>
        <div>
          <div>
            {smartAccountClient && (
              <>Smart account: {smartAccountClient.account.address}</>
            )}
          </div>
          <div>
            {smartAccountClient && <>Webauthn credential: {credential.id}</>}
          </div>
          <div>{validatorIsInstalled && <>Validator installed</>}</div>
        </div>

        <div className="flex gap-4 items-center flex-col sm:flex-row">
          <Button
            buttonText="Create Credential"
            onClick={handleCreateCredential}
          />
          <Button
            buttonText="Install Webauthn Module"
            onClick={handleInstallModule}
            isLoading={validatorInstallationLoading}
          />
          <Button
            buttonText="Send UserOp"
            onClick={handleSendUserOp}
            isLoading={userOpLoading}
          />
        </div>
      </main>
      <Footer count={count} />
    </div>
  );
}
