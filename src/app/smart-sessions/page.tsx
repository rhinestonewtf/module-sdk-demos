"use client";
import { Button } from "@/components/Button";
import { Connector } from "@/components/Connector";
import { getCount, getIncrementCalldata } from "@/components/Counter";
import Image from "next/image";
import { useCallback, useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import {
  toSafeSmartAccount,
  ToSafeSmartAccountReturnType,
} from "permissionless/accounts";
import { Address, Chain, Hex, http, toBytes, toHex, Transport } from "viem";
import { Erc7579Actions } from "permissionless/actions/erc7579";
import { createSmartAccountClient, SmartAccountClient } from "permissionless";
import {
  entryPoint07Address,
  getUserOperationHash,
} from "viem/account-abstraction";
import {
  RHINESTONE_ATTESTER_ADDRESS,
  MOCK_ATTESTER_ADDRESS,
  getOwnableValidator,
  encodeValidatorNonce,
  getAccount,
  Session,
  OWNABLE_VALIDATOR_ADDRESS,
  encodeValidationData,
  getSudoPolicy,
  getSmartSessionsValidator,
  encodeSmartSessionSignature,
  getOwnableValidatorMockSignature,
  SmartSessionMode,
  getPermissionId,
  SMART_SESSIONS_ADDRESS,
} from "@rhinestone/module-sdk";
import { baseSepolia } from "viem/chains";
import { getAccountNonce } from "permissionless/actions";
import { pimlicoBaseSepoliaUrl, pimlicoClient } from "@/utils/clients";
import { erc7579Actions } from "permissionless/actions/erc7579";
import { Footer } from "@/components/Footer";
import { getNonce } from "@/components/NonceManager";
import { privateKeyToAccount } from "viem/accounts";

const appId = "smart-sessions";

const sessionOwner = privateKeyToAccount(
  process.env.NEXT_PUBLIC_SESSION_OWNER_PK! as Hex,
);

const session: Session = {
  sessionValidator: OWNABLE_VALIDATOR_ADDRESS,
  sessionValidatorInitData: encodeValidationData({
    threshold: 1,
    owners: [sessionOwner.address],
  }),
  salt: toHex(toBytes("0", { size: 32 })),
  userOpPolicies: [getSudoPolicy()],
  erc7739Policies: {
    allowedERC7739Content: [],
    erc1271Policies: [],
  },
  actions: [
    {
      actionTarget: "0x19575934a9542be941d3206f3ecff4a5ffb9af88" as Address,
      actionTargetSelector: "0xd09de08a" as Hex,
      actionPolicies: [getSudoPolicy()],
    },
  ],
  chainId: BigInt(baseSepolia.id),
  permitERC4337Paymaster: true,
};

export default function Home() {
  const account = useAccount();
  const publicClient = usePublicClient();
  const walletClient = useWalletClient();

  const [smartAccountClient, setSmartAccountClient] = useState<
    SmartAccountClient<Transport, Chain, ToSafeSmartAccountReturnType<"0.7">> &
      Erc7579Actions<ToSafeSmartAccountReturnType<"0.7">>
  >();
  const [validatorIsInstalled, setValidatorIsInstalled] = useState(false);

  const [validatorInstallationLoading, setValidatorInstallationLoading] =
    useState(false);
  const [userOpLoading, setUserOpLoading] = useState(false);
  const [count, setCount] = useState<number>(0);

  const handleCreateSafe = useCallback(async () => {
    const owner = account.address;
    const walletAccount = walletClient.data;
    if (!owner) {
      console.error("No owner");
      return;
    } else if (!walletAccount) {
      console.error("No wallet account");
      return;
    } else if (!publicClient) {
      console.error("No public client");
      return;
    }

    const ownableValidator = getOwnableValidator({
      owners: [owner],
      threshold: 1,
    });

    const safeAccount = await toSafeSmartAccount({
      saltNonce: getNonce({
        appId,
      }),
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

    setSmartAccountClient(_smartAccountClient as any); // eslint-disable-line
    setCount(await getCount({ publicClient, account: safeAccount.address }));

    if (await publicClient?.getCode({ address: safeAccount.address })) {
      const isValidatorInstalled = await _smartAccountClient.isModuleInstalled(
        getSmartSessionsValidator({}),
      );
      if (isValidatorInstalled) {
        setValidatorIsInstalled(true);
      }
    }
  }, [account, publicClient, walletClient]);

  const handleInstallModule = useCallback(async () => {
    if (!smartAccountClient) {
      console.error("No smart account client");
      return;
    }

    setValidatorInstallationLoading(true);

    const validator = getSmartSessionsValidator({
      sessions: [session],
    });

    const installOp = await smartAccountClient.installModule(validator);

    const receipt = await smartAccountClient.waitForUserOperationReceipt({
      hash: installOp,
    });
    console.log("receipt", receipt);

    if (await smartAccountClient.isModuleInstalled(validator)) {
      setValidatorIsInstalled(true);
    }
    setValidatorInstallationLoading(false);
  }, [smartAccountClient]);

  const handleSendUserOp = useCallback(async () => {
    if (!smartAccountClient) {
      console.error("No smart account client");
      return;
    } else if (!publicClient) {
      console.error("No public client");
      return;
    }

    setUserOpLoading(true);

    const nonce = await getAccountNonce(publicClient, {
      address: smartAccountClient.account.address,
      entryPointAddress: entryPoint07Address,
      key: encodeValidatorNonce({
        account: getAccount({
          address: smartAccountClient.account.address,
          type: "safe",
        }),
        validator: SMART_SESSIONS_ADDRESS,
      }),
    });

    const sessionDetails = {
      mode: SmartSessionMode.USE,
      permissionId: getPermissionId({ session }),
      signature: getOwnableValidatorMockSignature({
        threshold: 1,
      }),
    };

    const userOperation = await smartAccountClient.prepareUserOperation({
      account: smartAccountClient.account,
      calls: [getIncrementCalldata()],
      nonce,
      signature: encodeSmartSessionSignature(sessionDetails),
    });

    const userOpHashToSign = getUserOperationHash({
      chainId: baseSepolia.id,
      entryPointAddress: entryPoint07Address,
      entryPointVersion: "0.7",
      userOperation,
    });

    const sessionOwner = privateKeyToAccount(
      process.env.NEXT_PUBLIC_SESSION_OWNER_PK! as Hex,
    );

    sessionDetails.signature = await sessionOwner.signMessage({
      message: { raw: userOpHashToSign },
    });

    userOperation.signature = encodeSmartSessionSignature(sessionDetails);

    const userOpHash =
      await smartAccountClient.sendUserOperation(userOperation);

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
  }, [publicClient, smartAccountClient]);

  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <main className="flex flex-col gap-8 row-start-2 items-center sm:items-start">
        <Connector requiredChainId={baseSepolia.id} />
        <div className="flex flex-row items-center align-center">
          <Image
            className="dark:invert"
            src="/rhinestone.svg"
            alt="Rhinestone logo"
            width={180}
            height={38}
            priority
          />{" "}
          <span className="text-lg font-bold">x Smart Sessions</span>
        </div>
        <ol className="list-inside list-decimal text-sm text-center sm:text-left font-[family-name:var(--font-geist-mono)]">
          <li className="mb-2">Connect your EOA.</li>
          <li className="mb-2">Create a smart account.</li>
          <li className="mb-2">Install the smart session module.</li>
          <li className="mb-2">
            Use the session key to send UserOperations without a user signature.
          </li>
        </ol>
        <div className="font-[family-name:var(--font-geist-mono)] text-sm">
          <div>
            {smartAccountClient && (
              <>Smart account: {smartAccountClient.account.address}</>
            )}
          </div>
          <div>
            {sessionOwner && <>Session owner: {sessionOwner.address}</>}
          </div>
          <div>
            {smartAccountClient && (
              <>Validator {!validatorIsInstalled && "not"} installed</>
            )}
          </div>
        </div>

        <div className="flex gap-4 items-center flex-col sm:flex-row">
          <Button buttonText="Create Account" onClick={handleCreateSafe} />
          <Button
            buttonText="Install Smart Sessions"
            disabled={validatorIsInstalled}
            onClick={handleInstallModule}
            isLoading={validatorInstallationLoading}
          />
          <Button
            buttonText="Send UserOp"
            disabled={!validatorIsInstalled}
            onClick={handleSendUserOp}
            isLoading={userOpLoading}
          />
        </div>
      </main>
      <Footer count={count} appId={appId} />
    </div>
  );
}
