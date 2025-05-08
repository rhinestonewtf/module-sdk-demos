import { NextResponse } from 'next/server';
import { createNodeClient, BlockTag, KeystoreAddress, BlockTagOrNumber } from '@axiom-crypto/keystore-sdk';
import { createPublicClient, http, PublicClient } from 'viem';
import { baseSepolia } from 'viem/chains';

// The Axiom Keystore RPC endpoint
const AXIOM_KEYSTORE_RPC_URL = 'https://keystore-rpc-node.axiom.xyz';

// Keystore Cache contract on Base Sepolia
const AXIOM_KEYSTORE_CACHE = '0xbE8877ab2B97e8Ca4A2d0Ae9B10ed12cC9646190';

// Simple ABI for reading the latestKeystoreStateRoot
const CACHE_ABI = [
  {
    inputs: [],
    name: 'latestKeystoreStateRoot',
    outputs: [{ internalType: 'bytes32', name: '', type: 'bytes32' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// Create the SDK client
const keystoreNodeClient = createNodeClient({
  url: AXIOM_KEYSTORE_RPC_URL,
});

// Create a client to read from the cache contract on Base Sepolia
const baseSepoliaClient = createPublicClient({
  chain: baseSepolia,
  transport: http(),
});

/**
 * API route handler to proxy requests to Axiom Keystore
 * This avoids CORS issues when calling from the browser
 */
export async function POST(request: Request) {
  try {
    // Get the request body from the incoming request
    const body = await request.json();

    // Handle getProof requests using the SDK directly
    if (body.method === 'axiom_getProof') {
      try {
        // Extract the parameters
        const address = body.params.address as string;

        // Get the latest keystore state root from the cache contract
        // We don't want to fall back to 'latest' - we must get the state root
        const result = await baseSepoliaClient.readContract({
          address: AXIOM_KEYSTORE_CACHE,
          abi: CACHE_ABI,
          functionName: 'latestKeystoreStateRoot',
        });

        // Verify that we got a valid state root
        if (!result) {
          throw new Error('Failed to get a valid state root from the cache contract');
        }

        console.log('Using keystore state root from cache:', result);

        // Convert the result to the appropriate type for the SDK
        const stateRoot = result as `0x${string}` as BlockTagOrNumber;

        // Call the SDK with the state root
        const proofResponse = await keystoreNodeClient.getProof({
          address: address as unknown as KeystoreAddress,
          block: stateRoot,
        });

        return NextResponse.json({
          jsonrpc: '2.0',
          id: body.id,
          result: proofResponse,
        });
      } catch (sdkError) {
        console.error('Error:', sdkError);
        return NextResponse.json({
          jsonrpc: '2.0',
          id: body.id,
          error: {
            message: `Error: ${sdkError instanceof Error ? sdkError.message : String(sdkError)}`,
          },
        });
      }
    }

    // For other requests, forward them to the Axiom RPC endpoint as before
    const response = await fetch(AXIOM_KEYSTORE_RPC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    // Get the response data
    const data = await response.json();

    // Return the response to the client
    return NextResponse.json(data);
  } catch (error) {
    // Handle errors
    console.error('Error proxying request to Axiom Keystore:', error);
    return NextResponse.json(
      {
        error: {
          message: error instanceof Error ? error.message : 'Failed to proxy request to Axiom Keystore',
        },
      },
      { status: 500 }
    );
  }
}
