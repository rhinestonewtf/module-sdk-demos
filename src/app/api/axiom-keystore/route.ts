import { NextResponse } from 'next/server';
import { createNodeClient, KeystoreAddress } from '@axiom-crypto/keystore-sdk';
import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';

// The Axiom Keystore RPC endpoint
const AXIOM_KEYSTORE_RPC_URL = 'https://keystore-rpc-node.axiom.xyz';

// Keystore Cache contract on Base Sepolia
const AXIOM_KEYSTORE_CACHE = '0x51886f20EAC4347a5978A5590eBb065Ce5830bB1';

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
 * GET handler to fetch proof for a keystore address
 */
export async function GET(request: Request) {
  try {
    // Get the keystore address from the URL search params
    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address');

    if (!address) {
      return NextResponse.json({ error: 'Missing required parameter: address' }, { status: 400 });
    }

    try {
      // Get the latest keystore state root from the cache contract
      const stateRoot = (await baseSepoliaClient.readContract({
        address: AXIOM_KEYSTORE_CACHE,
        abi: CACHE_ABI,
        functionName: 'latestKeystoreStateRoot',
      })) as `0x${string}`;

      // Verify that we got a valid state root
      if (!stateRoot) {
        throw new Error('Failed to get a valid state root from the cache contract');
      }

      console.log('Using keystore state root from cache:', stateRoot);

      // Call the SDK to get the block number
      const blockNumber = await keystoreNodeClient.getBlockNumberByStateRoot({
        stateRoot: stateRoot,
      });

      // Call the SDK with the block number
      const proofResponse = await keystoreNodeClient.getProof({
        address: address as unknown as KeystoreAddress,
        block: blockNumber,
      });

      return NextResponse.json(proofResponse);
    } catch (sdkError) {
      console.error('Error fetching proof:', sdkError);
      return NextResponse.json(
        { error: `Failed to fetch proof: ${sdkError instanceof Error ? sdkError.message : String(sdkError)}` },
        { status: 500 }
      );
    }
  } catch (error) {
    // Handle errors
    console.error('Error processing request:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process request' },
      { status: 500 }
    );
  }
}

/**
 * Fallback POST handler for other requests
 */
export async function POST(request: Request) {
  try {
    // For other requests, forward them to the Axiom RPC endpoint
    const body = await request.json();

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
        error: error instanceof Error ? error.message : 'Failed to proxy request to Axiom Keystore',
      },
      { status: 500 }
    );
  }
}
