import { keccak256, toHex } from "viem";
import { Button } from "./Button";

export const getNonce = ({ appId }: { appId: string }): bigint => {
  const nonce = parseInt(localStorage.getItem("accountNonce") || "0");
  const encodedNonce = keccak256(toHex(appId + nonce.toString()));
  return BigInt(encodedNonce);
};

export const NonceManager = ({ appId }: { appId: string }) => {
  const handleIncreaseNonce = () => {
    const nonce = getNonce({
      appId,
    });
    if (nonce) {
      localStorage.setItem("accountNonce", (nonce + 1n).toString());
    } else {
      localStorage.setItem("accountNonce", "1");
    }
  };
  return (
    <Button onClick={handleIncreaseNonce} buttonText="New account nonce" />
  );
};
