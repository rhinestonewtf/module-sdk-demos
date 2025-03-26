import { Address, Hex } from "viem";

export interface SmartAccount {
  address: Address;
  initCode: {
    factory: Address;
    factoryData: Hex;
  };
}
