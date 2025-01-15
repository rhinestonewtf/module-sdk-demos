"use client";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { Button } from "./Button";
import { baseSepolia } from "viem/chains";

export function Connector({ requiredChainId }: { requiredChainId: number }) {
  const account = useAccount();
  const { connectors, connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  return (
    <div className="font-[family-name:var(--font-geist-mono)] text-sm flex items-end">
      {account.status === "connected" || account.status === "reconnecting" ? (
        <div>
          <div className="mb-2">Account: {account.address}</div>
          <div className="flex flex-row gap-x-2">
            {account.chainId !== requiredChainId && (
              <Button
                buttonText="Switch network"
                onClick={() => switchChain({ chainId: requiredChainId })}
              />
            )}
            <Button buttonText="Disconnect" onClick={() => disconnect()} />
          </div>
        </div>
      ) : (
        <div>
          <div className="mb-2">Connect Wallet</div>
          <div className="flex gap-4 items-center flex-col sm:flex-row">
            {connectors.map((connector) => (
              <Button
                key={connector.uid}
                buttonText={connector.name}
                onClick={() => connect({ connector })}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
