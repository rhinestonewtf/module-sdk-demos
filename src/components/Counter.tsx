import { Address, parseAbi, PublicClient } from "viem";

export const getIncrementCalldata = () => {
  return {
    to: "0x19575934a9542be941d3206f3ecff4a5ffb9af88",
    value: BigInt(0),
    data: "0xd09de08a",
  };
};

export const getCount = async ({
  publicClient,
  account,
}: {
  publicClient: PublicClient;
  account: Address;
}): Promise<number> => {
  const count = (await publicClient.readContract({
    address: "0x19575934a9542be941d3206f3ecff4a5ffb9af88" as Address,
    abi: parseAbi(["function number(address) external returns(uint256)"]),
    functionName: "number",
    args: [account],
  })) as number;
  return count;
};

export const Counter = ({ count }: { count: number }) => {
  return (
    <div className="font-[family-name:var(--font-geist-mono)] text-sm">
      Count: {count}
    </div>
  );
};
