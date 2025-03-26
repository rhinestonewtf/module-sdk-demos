"use server";

import { Chain, createPublicClient, Hex, http, parseGwei } from "viem";
import { SmartAccount } from "./types";
import { privateKeyToAccount } from "viem/accounts";

export const deployAccount = async ({
  account,
  chain,
}: {
  account: SmartAccount;
  chain: Chain;
}) => {
  const publicClient = createPublicClient({
    chain,
    transport: http(),
  });

  const fundingAccount = privateKeyToAccount(
    process.env.DEPLOYER_PRIVATE_KEY! as Hex,
  );

  // const { maxFeePerGas, maxPriorityFeePerGas } =
  //   await publicClient.estimateFeesPerGas();

  const nonce = await publicClient.getTransactionCount({
    address: fundingAccount.address,
  });

  const deploymentTxHash = await publicClient.sendRawTransaction({
    serializedTransaction: await fundingAccount.signTransaction({
      to: account.initCode.factory,
      data: account.initCode.factoryData,
      chainId: chain.id,
      type: "eip1559",
      maxFeePerGas: parseGwei("0.01"),
      maxPriorityFeePerGas: parseGwei("0.01"),
      gas: 900000n,
      nonce,
    }),
  });

  return deploymentTxHash;
};
