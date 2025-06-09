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
  Account,
  Address,
  Chain,
  createPublicClient,
  encodeFunctionData,
  Hex,
  http,
  parseAbi,
  toBytes,
  toHex,
  Transport,
  zeroAddress,
} from "viem";
import { signAuthorization } from "viem/actions";
import { Erc7579Actions } from "permissionless/actions/erc7579";
import { createSmartAccountClient, SmartAccountClient } from "permissionless";
import {
  entryPoint07Address,
  getUserOperationHash,
} from "viem/account-abstraction";
import {
  RHINESTONE_ATTESTER_ADDRESS,
  MOCK_ATTESTER_ADDRESS,
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
import { sepolia } from "viem/chains";
import { getAccountNonce } from "permissionless/actions";
import { erc7579Actions } from "permissionless/actions/erc7579";
import { Footer } from "@/components/Footer";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { writeContract } from "viem/actions";
import { createPimlicoClient } from "permissionless/clients/pimlico";

const appId = "smart-sessions-7702";

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
  chainId: BigInt(sepolia.id),
  permitERC4337Paymaster: true,
};

export default function Home() {
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(),
  });

  const [account, setAccount] = useState<Account>();
  const [safeOwner, setSafeOwner] = useState<Account>();

  const [smartAccountClient, setSmartAccountClient] = useState<
    SmartAccountClient<Transport, Chain, ToSafeSmartAccountReturnType<"0.7">> &
      Erc7579Actions<ToSafeSmartAccountReturnType<"0.7">>
  >();
  const [accountIsDelegated, setAccountIsDelegated] = useState(false);

  const [delegationLoading, setDelegationLoading] = useState(false);
  const [userOpLoading, setUserOpLoading] = useState(false);
  const [count, setCount] = useState<number>(0);

  useEffect(() => {
    const localAccount = localStorage.getItem("7702-account") || "";
    if (localAccount) {
      setAccount(privateKeyToAccount(localAccount as Hex));
    }

    const localOwner = localStorage.getItem("7702-owner") || "";
    if (localOwner) {
      setSafeOwner(privateKeyToAccount(localOwner as Hex));
    }
  }, []);

  const handleCreateAccount = useCallback(async () => {
    const accountKey = generatePrivateKey();
    const _account = privateKeyToAccount(accountKey);
    setAccount(_account);
    localStorage.setItem("7702-account", accountKey);

    // note: currently the safe doesnt allow address(this) to be an owner
    const ownerKey = generatePrivateKey();
    const _safeOwner = privateKeyToAccount(ownerKey);
    setSafeOwner(_safeOwner);
    localStorage.setItem("7702-owner", ownerKey);

    setAccountIsDelegated(false);

    if (
      await publicClient?.getCode({
        address: _account.address,
      })
    ) {
      setAccountIsDelegated(true);
    }
  }, [publicClient]);

  const handleDelegateAccount = useCallback(async () => {
    if (!account) {
      console.error("No account");
      return;
    } else if (!safeOwner) {
      console.error("No safe owner");
      return;
    } else if (!publicClient) {
      console.error("No public client");
      return;
    }

    setDelegationLoading(true);

    const smartSessions = getSmartSessionsValidator({
      sessions: [session],
    });

    const sponsorAccount = privateKeyToAccount(
      process.env.NEXT_PUBLIC_SPONSOR_PK! as Hex,
    );

    const authorization = await signAuthorization(publicClient, {
      account: account,
      contractAddress: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
      executor: sponsorAccount,
    });

    const txHash = await writeContract(publicClient, {
      address: account.address,
      abi: parseAbi([
        "function setup(address[] calldata _owners,uint256 _threshold,address to,bytes calldata data,address fallbackHandler,address paymentToken,uint256 payment, address paymentReceiver) external",
      ]),
      functionName: "setup",
      args: [
        [safeOwner.address],
        BigInt(1),
        "0x7579011aB74c46090561ea277Ba79D510c6C00ff",
        encodeFunctionData({
          abi: parseAbi([
            "struct ModuleInit {address module;bytes initData;}",
            "function addSafe7579(address safe7579,ModuleInit[] calldata validators,ModuleInit[] calldata executors,ModuleInit[] calldata fallbacks, ModuleInit[] calldata hooks,address[] calldata attesters,uint8 threshold) external",
          ]),
          functionName: "addSafe7579",
          args: [
            "0x7579EE8307284F293B1927136486880611F20002",
            [
              {
                module: smartSessions.address,
                initData: smartSessions.initData,
              },
            ],
            [],
            [],
            [],
            [
              RHINESTONE_ATTESTER_ADDRESS, // Rhinestone Attester
              MOCK_ATTESTER_ADDRESS, // Mock Attester - do not use in production
            ],
            1,
          ],
        }),
        "0x7579EE8307284F293B1927136486880611F20002",
        zeroAddress,
        BigInt(0),
        zeroAddress,
      ],
      account: sponsorAccount,
      authorizationList: [authorization],
    });

    await publicClient.waitForTransactionReceipt({
      hash: txHash,
    });

    getSmartAccountClient();
    getDelegationState();

    setDelegationLoading(false);
  }, [account, publicClient, safeOwner]);

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
      chainId: sepolia.id,
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

  const getDelegationState = useCallback(async () => {
    if (!account) {
      return;
    } else if (!publicClient) {
      return;
    }

    if (
      await publicClient?.getCode({
        address: account.address,
      })
    ) {
      setAccountIsDelegated(true);
    } else {
      setAccountIsDelegated(false);
    }
  }, [account, publicClient]);

  const getSmartAccountClient = useCallback(async () => {
    if (!account) {
      return;
    } else if (!safeOwner) {
      return;
    } else if (!publicClient) {
      return;
    }

    const safeAccount = await toSafeSmartAccount({
      address: account.address,
      client: publicClient,
      owners: [safeOwner],
      version: "1.4.1",
      entryPoint: {
        address: entryPoint07Address,
        version: "0.7",
      },
      safe4337ModuleAddress: "0x7579EE8307284F293B1927136486880611F20002",
      erc7579LaunchpadAddress: "0x7579011aB74c46090561ea277Ba79D510c6C00ff",
    });

    const pimlicoSepoliaUrl = `https://api.pimlico.io/v2/${sepolia.id}/rpc?apikey=${process.env.NEXT_PUBLIC_PIMLICO_API_KEY}`;

    const pimlicoClient = createPimlicoClient({
      transport: http(pimlicoSepoliaUrl),
      entryPoint: {
        address: entryPoint07Address,
        version: "0.7",
      },
    });

    const _smartAccountClient = createSmartAccountClient({
      account: safeAccount,
      paymaster: pimlicoClient,
      chain: sepolia,
      userOperation: {
        estimateFeesPerGas: async () =>
          (await pimlicoClient.getUserOperationGasPrice()).fast,
      },
      bundlerTransport: http(pimlicoSepoliaUrl),
    }).extend(erc7579Actions());

    setSmartAccountClient(_smartAccountClient as any); // eslint-disable-line
  }, [account, publicClient, safeOwner]);

  useEffect(() => {
    const fetchInitialAccountState = async () => {
      if (!account || !publicClient) {
        return;
      }

      if (
        !smartAccountClient ||
        smartAccountClient.account.address !== account.address
      ) {
        setCount(
          await getCount({
            publicClient,
            account: account.address,
          }),
        );

        getDelegationState();
        getSmartAccountClient();
      }
    };

    fetchInitialAccountState();
  }, [
    account,
    publicClient,
    smartAccountClient,
    getDelegationState,
    getSmartAccountClient,
  ]);

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
          <span className="text-lg font-bold">x 7702</span>
        </div>
        <ol className="list-inside list-decimal text-sm text-center sm:text-left font-[family-name:var(--font-geist-mono)]">
          <li className="mb-2">Create an EOA.</li>
          <li className="mb-2">Delegate to a smart account.</li>
          <li className="mb-2">
            Use the session key to send UserOperations without a user signature.
          </li>
        </ol>
        <div className="font-[family-name:var(--font-geist-mono)] text-sm">
          <div>{account && <>Account: {account.address}</>}</div>
          <div>
            {sessionOwner && <>Session owner: {sessionOwner.address}</>}
          </div>
          <div>
            {account && <>Account {!accountIsDelegated && "not"} delegated</>}
          </div>
        </div>

        <div className="flex gap-4 items-center flex-col sm:flex-row">
          <Button buttonText="Create EOA" onClick={handleCreateAccount} />
          <Button
            buttonText="Delegate to Smart Account"
            disabled={!account || accountIsDelegated}
            onClick={handleDelegateAccount}
            isLoading={delegationLoading}
          />
          <Button
            buttonText="Send UserOp"
            disabled={!accountIsDelegated}
            onClick={handleSendUserOp}
            isLoading={userOpLoading}
          />
        </div>
      </main>
      <Footer count={count} appId={appId} />
    </div>
  );
}
