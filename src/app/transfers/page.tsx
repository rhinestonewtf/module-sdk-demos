"use client";
import { Button } from "@/components/Button";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import {
  Address,
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  erc20Abi,
  getAddress,
  http,
  isAddress,
  keccak256,
  parseAbi,
  slice,
  zeroAddress,
} from "viem";
import {
  createWebAuthnCredential,
  P256Credential,
} from "viem/account-abstraction";
import {
  RHINESTONE_ATTESTER_ADDRESS,
  getWebAuthnValidator,
  WEBAUTHN_VALIDATOR_ADDRESS,
  getWebauthnValidatorSignature,
} from "@rhinestone/module-sdk";
import { arbitrum, arbitrumSepolia, base, baseSepolia } from "viem/chains";
import { PublicKey } from "ox";
import { sign } from "ox/WebAuthnP256";
import { Footer } from "@/components/Footer";
import { getNonce } from "@/components/NonceManager";
import {
  getHookAddress,
  getSameChainModuleAddress,
  getTargetModuleAddress,
  getTokenAddress,
} from "@rhinestone/orchestrator-sdk";
import { SmartAccount } from "@/utils/types";
import { deployAccount } from "@/utils/deployment";
import { getBundle, sendIntent } from "@/utils/orchestrator";
import { verifyHash } from "viem/actions";

const appId = "omni-transfers";

const sourceChain = base;
const targetChain = arbitrum;

export default function Home() {
  const [smartAccount, setSmartAccount] = useState<SmartAccount | null>(null);
  const [credential, setCredential] = useState<P256Credential>(() =>
    JSON.parse(localStorage.getItem("credential") || "null"),
  );

  const [isAccountDeployed, setIsAccountDeployed] = useState(false);

  const [transferLoading, setTransferLoading] = useState(false);
  const [deployAccountLoading, setDeployAccountLoading] = useState(false);
  const [usdcBalance, setUsdcBalance] = useState<number>(0);

  const [targetAddress, setTargetAddress] = useState<string>("");
  const [amount, setAmount] = useState<string>("");

  const [error, setError] = useState<string | null>(null);

  const getBalance = async () => {
    if (smartAccount) {
      const publicClient = createPublicClient({
        chain: sourceChain,
        transport: http(),
      });

      const balance = await publicClient.readContract({
        address: getTokenAddress("USDC", sourceChain.id),
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [smartAccount.address],
      });

      setUsdcBalance(Number(balance) / 10 ** 6);
    }
  };

  useEffect(() => {
    getBalance();
  }, [smartAccount]);

  const createSafe = useCallback(async (_credential: P256Credential) => {
    const publicClient = createPublicClient({
      chain: sourceChain,
      transport: http(),
    });

    const { x, y, prefix } = PublicKey.from(_credential.publicKey);
    const webauthnValidator = getWebAuthnValidator({
      pubKey: { x, y, prefix },
      authenticatorId: _credential.id,
    });

    const initializer = encodeFunctionData({
      abi: parseAbi([
        "function setup(address[] calldata _owners,uint256 _threshold,address to,bytes calldata data,address fallbackHandler,address paymentToken,uint256 payment, address paymentReceiver) external",
      ]),
      functionName: "setup",
      args: [
        ["0x000000000000000000000000000000000000dead"],
        BigInt(1),
        "0x7579011aB74c46090561ea277Ba79D510c6C00ff",
        encodeFunctionData({
          abi: parseAbi([
            "struct ModuleInit {address module;bytes initData;}",
            "function addSafe7579(address safe7579,ModuleInit[] calldata validators,ModuleInit[] calldata executors,ModuleInit[] calldata fallbacks, ModuleInit[] calldata hooks,address[] calldata attesters,uint8 threshold) external",
          ]),
          functionName: "addSafe7579",
          args: [
            "0x7579EE8307284F293B1927136486880611F20002",
            [
              {
                module: webauthnValidator.address,
                initData: webauthnValidator.initData,
              },
            ],
            [
              {
                module: getSameChainModuleAddress(targetChain.id),
                initData: "0x",
              },
              {
                module: getTargetModuleAddress(targetChain.id),
                initData: "0x",
              },
              {
                module: getHookAddress(targetChain.id),
                initData: "0x",
              },
            ],
            [
              {
                module: getTargetModuleAddress(targetChain.id),
                initData: encodeAbiParameters(
                  [
                    { name: "selector", type: "bytes4" },
                    { name: "flags", type: "bytes1" },
                    { name: "data", type: "bytes" },
                  ],
                  ["0x3a5be8cb", "0x00", "0x"],
                ),
              },
            ],
            [
              {
                module: getHookAddress(targetChain.id),
                initData: encodeAbiParameters(
                  [
                    { name: "hookType", type: "uint256" },
                    { name: "hookId", type: "bytes4" },
                    { name: "data", type: "bytes" },
                  ],
                  [
                    0n,
                    "0x00000000",
                    encodeAbiParameters(
                      [{ name: "value", type: "bool" }],
                      [true],
                    ),
                  ],
                ),
              },
            ],
            [
              RHINESTONE_ATTESTER_ADDRESS, // Rhinestone Attester
              "0x6D0515e8E499468DCe9583626f0cA15b887f9d03", // Mock attester for omni account
            ],
            1,
          ],
        }),
        "0x7579EE8307284F293B1927136486880611F20002",
        zeroAddress,
        BigInt(0),
        zeroAddress,
      ],
    });

    const proxyFactory: Address = "0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67";
    const saltNonce = getNonce({
      appId,
    });
    const factoryData = encodeFunctionData({
      abi: parseAbi([
        "function createProxyWithNonce(address singleton,bytes calldata initializer,uint256 saltNonce) external payable returns (address)",
      ]),
      functionName: "createProxyWithNonce",
      args: [
        "0x29fcb43b46531bca003ddc8fcb67ffe91900c762",
        initializer,
        saltNonce,
      ],
    });

    const salt = keccak256(
      encodePacked(["bytes32", "uint256"], [keccak256(initializer), saltNonce]),
    );
    const hash = keccak256(
      encodePacked(
        ["bytes1", "address", "bytes32", "bytes32"],
        [
          "0xff",
          proxyFactory,
          salt,
          "0xe298282cefe913ab5d282047161268a8222e4bd4ed106300c547894bbefd31ee",
        ],
      ),
    );

    const accountAddress = getAddress(slice(hash, 12, 32));

    const code = await publicClient.getCode({
      address: accountAddress,
    });

    const isDeployed = !!code && code !== "0x";
    setIsAccountDeployed(isDeployed);

    setSmartAccount({
      address: accountAddress,
      initCode: {
        factory: proxyFactory,
        factoryData,
      },
    });
  }, []);

  const handleCreateCredential = useCallback(async () => {
    let _credential;
    if (credential) {
      _credential = credential;
    } else {
      _credential = await createWebAuthnCredential({
        name: "Wallet Owner",
      });
    }
    setCredential(_credential);
    localStorage.setItem(
      "credential",
      JSON.stringify({
        id: _credential.id,
        publicKey: _credential.publicKey,
      }),
    );
    await createSafe(_credential);
  }, [createSafe, credential]);

  const handleDeployAccount = useCallback(async () => {
    if (!smartAccount) {
      console.error("No smart account client");
      return;
    } else if (!credential) {
      console.error("No credential");
      return;
    }

    if (isAccountDeployed) {
      console.error("Account already deployed");
      return;
    }

    setDeployAccountLoading(true);

    const deploymentTxHash = await deployAccount({
      account: smartAccount,
      chain: sourceChain,
    });

    console.log("Deployment tx hash", deploymentTxHash);

    const publicClient = createPublicClient({
      chain: sourceChain,
      transport: http(),
    });

    await publicClient.waitForTransactionReceipt({
      hash: deploymentTxHash,
    });

    setDeployAccountLoading(false);
    setIsAccountDeployed(true);
  }, [credential, smartAccount, isAccountDeployed]);

  const handleTransfer = useCallback(async () => {
    setError(null);
    if (!smartAccount) {
      console.log("No smart account client");
      return;
    } else if (!credential) {
      console.log("No credential");
      return;
    }

    console.log(targetAddress, amount);

    if (!targetAddress || !amount) {
      console.log(targetAddress, amount);
      console.log("Please enter a target address and amount");
      setError("Please enter a target address and amount");
      return;
    } else if (!isAddress(targetAddress, { strict: false })) {
      setError("Invalid target address");
      return;
    } else if (Number(amount) > usdcBalance) {
      setError("Insufficient balance");
      return;
    } else if (Number(amount) > 10 * 10 ** 6) {
      setError("Amount must be less than 10 USDC");
      return;
    }

    setTransferLoading(true);

    const { orderPath, orderBundleHash } = await getBundle({
      targetChain,
      account: {
        address: smartAccount.address,
        initCode: "0x",
      },
      transfer: {
        amount: BigInt(Number(amount) * 10 ** 6),
        recipient: targetAddress,
      },
    });

    const { metadata: webauthn, signature } = await sign({
      credentialId: credential.id,
      challenge: orderBundleHash,
    });

    const encodedSignature = getWebauthnValidatorSignature({
      webauthn,
      signature,
      usePrecompiled: false,
    });

    const packedSig = encodePacked(
      ["address", "bytes"],
      [WEBAUTHN_VALIDATOR_ADDRESS, encodedSignature],
    );

    const publicClient = createPublicClient({
      chain: targetChain,
      transport: http(),
    });

    // console.log(smartAccount.address, orderBundleHash, packedSig);
    //
    // const isValidSig = await verifyHash(publicClient, {
    //   address: smartAccount.address,
    //   hash: orderBundleHash,
    //   signature: packedSig,
    // });
    // console.log("isValidSig", isValidSig);
    // if (!isValidSig) {
    //   console.error("Invalid signature");
    //   return;
    // }

    const code = await publicClient.getCode({
      address: smartAccount.address,
    });

    const isDeployed = !!code && code !== "0x";

    await sendIntent({
      orderPath,
      signature: packedSig,
      initCode: isDeployed
        ? "0x"
        : encodePacked(
            ["address", "bytes"],
            [smartAccount.initCode.factory, smartAccount.initCode.factoryData],
          ),
    });

    setTransferLoading(false);
  }, [credential, smartAccount, amount, targetAddress, usdcBalance]);

  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <main className="flex flex-col gap-8 row-start-2 items-center sm:items-start">
        <div className="flex flex-row items-center align-center">
          <Image
            className="dark:invert"
            src="/rhinestone.svg"
            alt="Rhinestone logo"
            width={180}
            height={38}
            priority
          />{" "}
          <span className="text-lg font-bold">x Omni Account Transfers</span>
        </div>
        <ol className="list-inside list-decimal text-sm text-center sm:text-left font-[family-name:var(--font-geist-mono)]">
          <li className="mb-2">Create a Webauthn Omni Account.</li>
          <li className="mb-2">
            Fund and deploy the account on the source chain.
          </li>
          <li className="mb-2">
            Create an instant transfer on the target chain.
          </li>
        </ol>
        <div className="font-[family-name:var(--font-geist-mono)] text-sm">
          <div>
            {smartAccount && <>Smart account: {smartAccount.address}</>}
          </div>
          <div>
            {smartAccount && credential && (
              <>Balance on Base: {usdcBalance} USDC</>
            )}
          </div>
          <div>{isAccountDeployed && <>Account deployed on Base</>}</div>
        </div>

        <div className="flex gap-4 justify-center items-center flex-col sm:flex-row">
          <input
            className="bg-white rounded-2xl text-black px-4 py-1"
            placeholder="Target address"
            onChange={(e) => setTargetAddress(e.target.value)}
            value={targetAddress}
            id="targetAddress"
          />
          <input
            className="bg-white rounded-2xl text-black px-4 py-1"
            placeholder="Amount in USDC"
            onChange={(e) => setAmount(e.target.value)}
            value={amount}
            type="number"
            id="amount"
          />
        </div>

        <div className="flex gap-4 items-center flex-col sm:flex-row">
          <Button
            buttonText="Create Credential"
            onClick={handleCreateCredential}
            disabled={!!smartAccount}
          />
          <Button
            buttonText="Deploy Account"
            disabled={!smartAccount || isAccountDeployed}
            onClick={handleDeployAccount}
            isLoading={deployAccountLoading}
          />

          <Button
            buttonText="Send Transfer"
            disabled={!isAccountDeployed}
            onClick={handleTransfer}
            isLoading={transferLoading}
          />
        </div>
        {error && (
          <div className="flex justify-center text-red-500 text-center w-full items-center">
            {error}
          </div>
        )}
      </main>
      <Footer count={0} appId={appId} />
    </div>
  );
}
