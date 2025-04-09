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
  weth,
  eth,
  legacy,
}: {
  targetChain: number;
  account: { address: Address; initCode: Hex };
  transfer: { amount: bigint; recipient: Address };
  weth?: boolean;
  eth?: boolean;
  legacy?: boolean;
}) => {
  const tokenTransfers = [
    {
      tokenAddress: getTokenAddress("USDC", targetChain),
      amount: transfer.amount,
    },
  ];

  if (weth) {
    tokenTransfers.push({
      tokenAddress: getTokenAddress("WETH", targetChain),
      amount: 1n,
    });
  }

  if (eth) {
    tokenTransfers.push({
      tokenAddress: getTokenAddress("ETH", targetChain),
      amount: 1n,
    });
  }

  // create the meta intent
  const metaIntent: MetaIntent = {
    targetChainId: targetChain,
    tokenTransfers: tokenTransfers,
    targetAccount: account.address,
    targetExecutions: [
      {
        to: getTokenAddress("USDC", targetChain),
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

  if (legacy) {
    orderPath[0].orderBundle.segments[0].witness.execs = [
      ...orderPath[0].injectedExecutions,
      ...metaIntent.targetExecutions,
    ];
  }

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
  return bundleResults[0].bundleId;
};

export const getBundleStatus = async ({ bundleId }: { bundleId: bigint }) => {
  return orchestrator.getBundleStatus(bundleId);
};
