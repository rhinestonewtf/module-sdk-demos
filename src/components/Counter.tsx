import { forwardRef, useImperativeHandle, useState } from "react";
import { Address, parseAbi, PublicClient } from "viem";

export interface CounterRef {
  updateCount: () => Promise<void>;
}

export const Counter = forwardRef(
  (
    { publicClient, account }: { publicClient: PublicClient; account: Address },
    ref,
  ) => {
    const [count, setCount] = useState<number>(0);

    useImperativeHandle(ref, () => ({
      updateCount: async () => {
        const newValue = await getCount({
          publicClient: publicClient,
          account: account,
        });
        setCount(newValue);
      },
    }));

    const getCount = async ({
      publicClient,
      account,
    }: {
      publicClient: PublicClient;
      account: Address;
    }): Promise<number> => {
      const count = (await publicClient.readContract({
        address: "0x6fc7314c80849622b04d943a6714b05078ca2d05" as Address,
        abi: parseAbi(["function count(address) external returns(uint256)"]),
        functionName: "count",
        args: [account],
      })) as number;
      return count;
    };

    return (
      <footer className="row-start-3 flex gap-6 flex-wrap items-center justify-center">
        Count: {count}
      </footer>
    );
  },
);
