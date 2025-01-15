import { createPimlicoClient } from "permissionless/clients/pimlico";
import {
  createPaymasterClient,
  entryPoint07Address,
} from "viem/account-abstraction";
import { http, cookieStorage, createConfig, createStorage } from "wagmi";
import { baseSepolia, mainnet } from "wagmi/chains";
import { injected } from "wagmi/connectors";

export function getConfig() {
  return createConfig({
    chains: [mainnet, baseSepolia],
    connectors: [injected()],
    storage: createStorage({
      storage: cookieStorage,
    }),
    ssr: true,
    transports: {
      [mainnet.id]: http("https://eth.drpc.org"),
      [baseSepolia.id]: http("https://sepolia.base.org"),
    },
  });
}

export const pimlicoBaseSepoliaUrl = `https://api.pimlico.io/v2/${baseSepolia.id}/rpc?apikey=${process.env.NEXT_PUBLIC_PIMLICO_API_KEY}`;

export const pimlicoClient = createPimlicoClient({
  transport: http(pimlicoBaseSepoliaUrl),
  entryPoint: {
    address: entryPoint07Address,
    version: "0.7",
  },
});

export const paymasterClient = createPaymasterClient({
  transport: http(pimlicoBaseSepoliaUrl),
});
