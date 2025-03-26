"use server";

import {
  Address,
  Chain,
  encodeFunctionData,
  encodePacked,
  erc20Abi,
  Hex,
} from "viem";
import {
  BundleStatus,
  Execution,
  getOrchestrator,
  getOrderBundleHash,
  getTokenAddress,
  MetaIntent,
  MultiChainCompact,
  PostOrderBundleResult,
  SignedMultiChainCompact,
} from "@rhinestone/orchestrator-sdk";

const orchestrator = getOrchestrator(process.env.ORCHESTRATOR_API_KEY!);

export const getBundle = async ({
  targetChain,
  account,
  transfer,
}: {
  targetChain: Chain;
  account: { address: Address; initCode: Hex };
  transfer: { amount: bigint; recipient: Address };
}) => {
  const tokenTransfers = [
    {
      tokenAddress: getTokenAddress("USDC", targetChain.id),
      amount: transfer.amount,
    },
  ];

  // create the meta intent
  const metaIntent: MetaIntent = {
    targetChainId: targetChain.id,
    tokenTransfers: tokenTransfers,
    targetAccount: account.address,
    targetExecutions: [
      {
        to: getTokenAddress("USDC", targetChain.id),
        value: 0n,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [transfer.recipient, transfer.amount],
        }),
      },
    ],
  };

  const orderPath = await orchestrator.getOrderPath(
    metaIntent,
    account.address,
  );

  orderPath[0].orderBundle.segments[0].witness.execs = [
    ...orderPath[0].injectedExecutions,
    ...metaIntent.targetExecutions,
  ];

  // sign the meta intent
  const orderBundleHash = getOrderBundleHash(orderPath[0].orderBundle);
  return { orderPath, orderBundleHash };
};

export const sendIntent = async ({
  orderPath,
  signature,
  initCode,
}: {
  orderPath: {
    orderBundle: MultiChainCompact;
    injectedExecutions: Execution[];
  }[];
  signature: Hex;
  initCode?: Hex;
}) => {
  const signedOrderBundle: SignedMultiChainCompact = {
    ...orderPath[0].orderBundle,
    originSignatures: Array(orderPath[0].orderBundle.segments.length).fill(
      signature,
    ),
    targetSignature: signature,
  };

  // send the signed bundle
  const bundleResults: PostOrderBundleResult =
    await orchestrator.postSignedOrderBundle([
      {
        signedOrderBundle,
        initCode,
      },
    ]);

  // check bundle status
  let bundleStatus = await orchestrator.getBundleStatus(
    bundleResults[0].bundleId,
  );

  let checks = 0;
  // check again every 2 seconds until the status changes
  // // @ts-ignore
  while (bundleStatus.status === BundleStatus.PENDING) {
    if (checks > 60) {
      throw new Error("Bundle failed to execute");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    bundleStatus = await orchestrator.getBundleStatus(
      bundleResults[0].bundleId,
    );
    console.log(bundleStatus);
    checks++;
  }
};
