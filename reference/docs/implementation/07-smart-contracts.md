# 07 — Smart Contracts

Stealth address contracts for each supported chain. Each chain needs an equivalent set deployed.

## Contract Set

| Contract | Purpose | EVM (Solidity) | Stellar (Soroban/Rust) |
|---|---|---|---|
| Announcer | Emits stealth address announcements | ERC5564Announcer | stealth-announcer |
| Registry | Maps addresses to stealth meta-addresses | ERC6538Registry | stealth-registry |
| Sender | Atomic send + announce | WraithSender | stealth-sender |
| Names | .wraith name → meta-address mapping | WraithNames | wraith-names |
| Withdrawer | Gas-sponsored withdrawals (EIP-7702) | WraithWithdrawer | N/A |

## EVM Contracts (Solidity)

### ERC5564Announcer

Minimal singleton. No storage, no access control. Just emits events.

```solidity
event Announcement(
    uint256 indexed schemeId,
    address indexed stealthAddress,
    address indexed caller,
    bytes ephemeralPubKey,
    bytes metadata  // first byte = view tag
);

function announce(
    uint256 schemeId,
    address stealthAddress,
    bytes memory ephemeralPubKey,
    bytes memory metadata
) external;
```

**Deployment:** One per chain. No constructor args. No proxy needed.

### ERC6538Registry

Maps addresses to stealth meta-addresses per ERC-6538. Supports direct and delegated registration via EIP-712 signatures.

```solidity
function registerKeys(uint256 schemeId, bytes calldata stealthMetaAddress) external;
function registerKeysOnBehalf(address registrant, uint256 schemeId, bytes calldata stealthMetaAddress, bytes calldata signature) external;
function stealthMetaAddressOf(address registrant, uint256 schemeId) external view returns (bytes memory);
function incrementNonce(address registrant) external;
function nonceOf(address registrant) external view returns (uint256);
```

### WraithSender

Atomically transfers assets to stealth addresses and publishes announcements. Uses ReentrancyGuard.

```solidity
function sendETH(
    uint256 schemeId,
    address stealthAddress,
    bytes memory ephemeralPubKey,
    bytes memory metadata
) external payable;

function sendERC20(
    uint256 schemeId,
    address stealthAddress,
    bytes memory ephemeralPubKey,
    bytes memory metadata,
    address token,
    uint256 amount,
    uint256 gasTip  // optional ETH tip for gas at stealth address
) external payable;

function batchSendETH(
    uint256 schemeId,
    address[] calldata stealthAddresses,
    bytes[] calldata ephemeralPubKeys,
    bytes[] calldata metadatas,
    uint256[] calldata amounts
) external payable;
```

**Constructor:** Takes announcer contract address.

### WraithNames

Privacy-preserving name registry. Maps human-readable names to stealth meta-addresses. Ownership proven via secp256k1 signature from the spending key embedded in the meta-address.

```solidity
function register(string calldata name, bytes calldata metaAddress, bytes calldata signature) external;
function registerOnBehalf(string calldata name, bytes calldata metaAddress, bytes calldata signature) external;
function update(string calldata name, bytes calldata newMetaAddress, bytes calldata signature) external;
function release(string calldata name, bytes calldata signature) external;
function resolve(string calldata name) external view returns (bytes memory);
function nameOf(bytes calldata metaAddress) external view returns (string memory);
```

**Name validation:** 3-32 chars, lowercase alphanumeric and hyphens only.

**Signature verification:** The contract decompresses the spending public key from the first 33 bytes of the meta-address and verifies the ECDSA signature over `keccak256(name || metaAddress)` with Ethereum signed message prefix.

**On-chain point decompression:** The contract includes `_decompressPoint(bytes33)` that computes `y = sqrt(x^3 + 7) mod p` on-chain for signature recovery.

### WraithWithdrawer

EIP-7702 delegation target for gas-sponsored stealth address withdrawals. A sponsor pays gas on behalf of the stealth address.

```solidity
function withdrawETH(address payable to, uint256 sponsorFee) external;
function withdrawERC20(address token, address to, uint256 sponsorFee) external;
function withdrawETHDirect(address payable to) external;
function withdrawERC20Direct(address token, address to) external;
```

## Stellar Contracts (Soroban/Rust)

### stealth-announcer

Emits announcement events. No storage.

```rust
pub fn announce(
    env: Env,
    caller: Address,
    scheme_id: u32,
    stealth_address: Address,
    ephemeral_pub_key: BytesN<32>,
    metadata: Bytes,
);
// Emits event: ("announce", caller, scheme_id, stealth_address, ephemeral_pub_key, metadata)
```

### stealth-registry

Maps addresses to 64-byte stealth meta-addresses.

```rust
pub fn register_keys(env: Env, registrant: Address, scheme_id: u32, stealth_meta_address: Bytes);
pub fn stealth_meta_address_of(env: Env, registrant: Address, scheme_id: u32) -> Bytes;
```

**Validation:** Enforces 64-byte meta-address length. Requires auth from registrant.

### stealth-sender

Atomic send + announce. Initializes with announcer contract address.

```rust
pub fn init(env: Env, admin: Address, announcer: Address);
pub fn send(env: Env, caller: Address, token: Address, stealth_address: Address, amount: i128, scheme_id: u32, ephemeral_pub_key: BytesN<32>, metadata: Bytes);
pub fn batch_send(env: Env, caller: Address, token: Address, stealth_addresses: Vec<Address>, amounts: Vec<i128>, scheme_id: u32, ephemeral_pub_keys: Vec<BytesN<32>>, metadatas: Vec<Bytes>);
```

### wraith-names

Name → meta-address mapping. Names hashed via SHA-256 for storage keys.

```rust
pub fn register(env: Env, caller: Address, name: String, meta_address: Bytes);
pub fn update(env: Env, caller: Address, name: String, new_meta_address: Bytes);
pub fn release(env: Env, caller: Address, name: String);
pub fn resolve(env: Env, name: String) -> Bytes;
pub fn name_of(env: Env, meta_address: Bytes) -> String;
```

**Validation:** 3-32 chars, lowercase alphanumeric. 64-byte meta-address.

## Deployment Checklist for a New Chain

### EVM Chain

1. Deploy ERC5564Announcer (no args)
2. Deploy ERC6538Registry (no args)
3. Deploy WraithSender (arg: announcer address)
4. Deploy WraithNames (no args)
5. Deploy WraithWithdrawer (no args) — optional, only if EIP-7702 supported
6. Set up subgraph to index Announcement events from ERC5564Announcer
7. Record contract addresses in chain connector config

```bash
npx hardhat run scripts/deploy.ts --network <chain>
```

### Stellar

1. Build contracts: `soroban contract build` for each
2. Deploy to testnet/mainnet via `soroban contract deploy`
3. Initialize stealth-sender with announcer address
4. Record contract IDs in chain connector config

## Indexing

### EVM: Subgraph (Goldsky)

Index `Announcement` events from the announcer contract:

```graphql
type Announcement @entity {
  id: ID!
  schemeId: BigInt!
  stealthAddress: Bytes!
  caller: Bytes!
  ephemeralPubKey: Bytes!
  metadata: Bytes!
  blockNumber: BigInt!
  transactionHash: Bytes!
}
```

### Stellar: Soroban RPC

Fetch events via `sorobanServer.getEvents()` with topic filter for the announcer contract's `announce` events.

## Testing

Contract tests live in `contracts/test/` (Hardhat + chai for EVM, native Rust tests for Stellar).

**EVM test coverage:**
- ERC5564Announcer: event emission, multiple callers, metadata preservation
- ERC6538Registry: register/lookup, EIP-712 delegation, replay prevention, nonce management
- WraithNames: register/resolve, reverse lookup, duplicate rejection, name validation, signature verification, update, release
- WraithSender: sendETH, sendERC20, batch operations, value mismatch rejection
- WraithWithdrawer: revert on empty balance, fee validation

```bash
cd contracts && npx hardhat test
```
