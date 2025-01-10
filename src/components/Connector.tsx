"use client";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { Button } from "./Button";

export function Connector() {
  const account = useAccount();
  const { connectors, connect } = useConnect();
  const { disconnect } = useDisconnect();

  return (
    <div className="font-[family-name:var(--font-geist-mono)] text-sm flex items-end">
      {account.status === "connected" || account.status === "reconnecting" ? (
        <div>
          <div className="mb-2">Account: {account.address}</div>
          {(account.status === "connected" ||
            account.status === "reconnecting") && (
            <Button buttonText="Disconnect" onClick={() => disconnect()} />
          )}
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
