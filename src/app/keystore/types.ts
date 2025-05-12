// Types for the Axiom Keystore response
interface KeystoreSibling {
  hash: `0x${string}`;
  isLeft: boolean;
}

interface KeystoreLeaf {
  hash: `0x${string}`;
  keyPrefix: `0x${string}`;
  key: `0x${string}`;
  nextKeyPrefix: `0x${string}`;
  nextKey: `0x${string}`;
  value: `0x${string}`;
}

interface KeystoreProof {
  isExclusionProof: boolean;
  siblings: KeystoreSibling[];
  leaf: KeystoreLeaf;
}

interface KeystoreState {
  dataHash: `0x${string}`;
  vkeyHash: `0x${string}`;
  data: `0x${string}`;
  vkey: `0x${string}`;
}

interface KeystoreProofResponse {
  state: KeystoreState;
  proof: KeystoreProof;
}

// Type for the Keystore proof data used by the validator
interface KeystoreProofData {
  isExclusion: boolean;
  exclusionExtraData: `0x${string}`;
  nextDummyByte: `0x${string}`;
  nextImtKey: `0x${string}`;
  vkeyHash: `0x${string}`;
  keyData: `0x${string}`;
  proof: `0x${string}`[];
  isLeft: bigint;
}

export type { KeystoreSibling, KeystoreLeaf, KeystoreProof, KeystoreState, KeystoreProofResponse, KeystoreProofData };
