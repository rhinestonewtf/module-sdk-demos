import { Button } from "./Button";

export const getNonce = () => {
  const nonce = localStorage.getItem("accountNonce");
  return BigInt(parseInt(nonce || "0"));
};

export const NonceManager = () => {
  const handleIncreaseNonce = () => {
    const nonce = getNonce();
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
