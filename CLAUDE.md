# Tank Battle Royale — Multiplayer Game Project

## Project overview

University course project: a multiplayer tank battle royale game built with Unity (client + dedicated headless server) and AWS infrastructure for authentication, matchmaking, and server provisioning.

This is a **learning project** — the team is new to Unity but has strong backend/distributed systems experience. Prioritize simplicity, clear code, and extensive comments over production polish.

## Architecture

```
Unity Client
    │
    │ HTTP (REST)
    ▼
API Gateway ──▶ Lambda (orchestrator) ──▶ Cognito (auth)
                    │
                    ▼
               GameLift + FlexMatch (matchmaking + server provisioning)
                    │
                    ▼
            Dedicated Game Server (Unity Headless on EC2 via GameLift fleet)
                    ▲
                    │ UDP (direct gameplay connection)
                    │
              Unity Client
```

### Flow

1. **Player opens game** → Unity client shows login/register screen.
2. **Auth** → Client sends credentials to API Gateway → Lambda → Cognito User Pool. Returns JWT.
3. **Find match** → Client sends JWT to API Gateway → Lambda validates token, then calls GameLift FlexMatch to queue the player for matchmaking.
4. **Match found** → FlexMatch groups enough players, GameLift provisions a dedicated server (or reuses one from the fleet). Lambda returns IP + port to client.
5. **Gameplay** → Client opens direct UDP connection to the dedicated server. All game state (movement, shooting, damage, elimination) flows over UDP. No more HTTP.
6. **Game ends** → Server reports results, session closes. Client returns to lobby.

### Key decisions

- **Server authoritative**: The dedicated server owns all game state. Clients send inputs (move direction, shoot command); server validates, simulates, and broadcasts results. This prevents cheating.
- **FlexMatch for matchmaking**: No custom Redis queue. GameLift's built-in matchmaking handles player grouping with configurable rules.
- **Cognito for auth**: No custom DynamoDB user table. Cognito User Pool handles registration, login, JWT issuance, and token validation via API Gateway authorizer.

## Tech stack

| Layer | Technology | Notes |
|---|---|---|
| Game client | Unity 2022 LTS, C# | Netcode for GameObjects (NGO) for networking |
| Game server | Unity Headless build, C# | Same Unity project, built with `SERVER` scripting define |
| Networking | Netcode for GameObjects (NGO) | Server authoritative, uses Unity Transport (UDP) |
| Auth | Amazon Cognito User Pool | JWT-based, integrated with API Gateway authorizer |
| API layer | API Gateway + Lambda (TypeScript/Node.js) | Single Lambda orchestrates auth verification + matchmaking |
| Matchmaking | GameLift FlexMatch | Rule-based matchmaking configuration |
| Server hosting | AWS GameLift Managed EC2 Fleet | Auto-scaling, session management, health checks |
| Infrastructure as Code | AWS CDK (TypeScript) | GameLift plugin provides CloudFormation templates as reference |

## Project structure

```
tank-battle-royale/
├── CLAUDE.md                          # This file
├── unity-project/                     # Unity project root
│   ├── Assets/
│   │   ├── Scripts/
│   │   │   ├── Shared/                # Code used by both client and server
│   │   │   │   ├── TankController.cs  # Tank movement, physics
│   │   │   │   ├── WeaponSystem.cs    # Shooting mechanics
│   │   │   │   ├── HealthSystem.cs    # Damage, elimination
│   │   │   │   ├── GameState.cs       # Match state (waiting, playing, ended)
│   │   │   │   └── NetworkMessages.cs # Custom RPCs and NetworkVariable definitions
│   │   │   ├── Client/               # Client-only code (#if CLIENT or !SERVER)
│   │   │   │   ├── UIManager.cs       # Login, lobby, HUD screens
│   │   │   │   ├── InputHandler.cs    # Read player input, send to server
│   │   │   │   ├── CameraController.cs
│   │   │   │   └── AuthClient.cs      # HTTP calls to API Gateway for login/matchmaking
│   │   │   └── Server/               # Server-only code (#if SERVER)
│   │   │       ├── ServerGameManager.cs   # Game loop: spawn, shrink zone, check winner
│   │   │       ├── GameLiftManager.cs     # GameLift Server SDK integration
│   │   │       └── ServerNetworkManager.cs # Accept connections, validate player sessions
│   │   ├── Prefabs/
│   │   │   └── Tank.prefab           # Tank with NetworkObject, NetworkTransform, etc.
│   │   └── Scenes/
│   │       ├── MainMenu.unity
│   │       ├── Lobby.unity
│   │       └── BattleArena.unity
│   └── Packages/
│       └── manifest.json             # NGO, Unity Transport, GameLift plugin
├── aws-infra/                         # AWS CDK app (TypeScript)
│   ├── bin/
│   │   └── app.ts                     # CDK app entry point
│   ├── lib/
│   │   ├── auth-stack.ts              # Cognito User Pool + Identity Pool
│   │   ├── api-stack.ts               # API Gateway + Lambda
│   │   └── gamelift-stack.ts          # GameLift fleet, FlexMatch config, alias
│   ├── lambda/
│   │   ├── matchmaking/
│   │   │   └── index.ts               # Validate JWT, call FlexMatch StartMatchmaking
│   │   └── auth/
│   │       └── index.ts               # (Optional) Custom auth logic if needed
│   ├── flexmatch/
│   │   └── matchmaking-config.json    # FlexMatch rule set (team size, latency rules)
│   ├── cdk.json
│   ├── tsconfig.json
│   └── package.json
└── docs/
    ├── architecture.md
    └── setup-guide.md
```

## What Claude Code can help with

### YES — generate these files

- **All C# scripts** in `Assets/Scripts/` — MonoBehaviours, NetworkBehaviours, RPCs, NetworkVariables, GameLift server SDK integration, HTTP client for API calls.
- **Lambda functions** in TypeScript — matchmaking orchestration, Cognito integration. Use `@aws-sdk/client-gamelift`, `@aws-sdk/client-cognito-identity-provider`, etc.
- **CDK stacks** in TypeScript — Cognito, API Gateway, Lambda, GameLift fleet, FlexMatch configuration.
- **FlexMatch rule sets** — JSON matchmaking configuration.
- **Package manifest** (`manifest.json`) with correct NGO and GameLift plugin references.
- **Documentation and setup guides**.

### NO — cannot do these (manual Unity Editor work)

- Create or modify Unity scenes (`.unity` files are binary/YAML — must use Unity Editor).
- Create prefabs visually (write the component code; attaching it is done in Editor).
- Import assets, configure project settings, set up build profiles.
- Build the Unity project (requires Unity Editor + Build pipeline).
- Test gameplay (requires running the game).

### Workflow suggestion

When generating Unity scripts, always include clear comments at the top of each file explaining:

1. What GameObject this script should be attached to.
2. What other components are required on that GameObject (e.g., NetworkObject, Rigidbody).
3. What fields need to be configured in the Unity Inspector.

Example:

```csharp
/// <summary>
/// Attach to: Tank prefab root GameObject
/// Required components: NetworkObject, NetworkTransform, Rigidbody, BoxCollider
/// Inspector config: Set moveSpeed=10, rotateSpeed=120, maxHealth=100
/// </summary>
```

## Game design (minimal viable version)

- **Players per match**: 4 (keep small for the course project)
- **Win condition**: Last tank standing
- **Core mechanics**: Move (WASD), rotate turret (mouse), shoot (click). Projectiles deal damage. Tanks have health bars.
- **Map**: Simple flat arena with some obstacles (walls/boxes). No shrinking zone for MVP — add later if time permits.
- **Session duration**: ~3-5 minutes per match.

## Coding conventions

- **C# (Unity)**: PascalCase for public methods/properties, camelCase for private fields with `_` prefix. Use `[SerializeField]` for Inspector-exposed private fields. Prefer `TryGetComponent` over `GetComponent`. Always null-check network references.
- **TypeScript (CDK + Lambda)**: camelCase for variables/functions, PascalCase for classes and construct names. Use `aws-cdk-lib` v2 (single package). Define each stack in its own file under `lib/`. Use interfaces for stack props. Prefer L2 constructs over L1 (Cfn*) unless no L2 exists (e.g., some GameLift resources). Always tag resources with `project: tank-battle-royale` and `environment: dev`. For Lambda functions, use `NodejsFunction` from `aws-cdk-lib/aws-lambda-nodejs` — it handles esbuild bundling automatically. Lambda handlers use AWS SDK v3 (`@aws-sdk/client-*` packages). Structure handlers with clear input validation → business logic → response pattern.
- **Comments**: Write generous comments. This is a learning project — explain WHY, not just what.
- **Preprocessor directives**: Use `#if SERVER` / `#if CLIENT` (not `!SERVER`) for clarity when code is exclusive to one build target.

## Key Unity + NGO concepts to apply

- `NetworkBehaviour` instead of `MonoBehaviour` for any networked script.
- `NetworkVariable<T>` for state that auto-syncs (health, score, alive status).
- `[ServerRpc]` for client → server calls (e.g., "I want to shoot").
- `[ClientRpc]` for server → client calls (e.g., "explosion VFX at position X").
- `NetworkObject` component required on any prefab that gets spawned over the network.
- `NetworkTransform` for automatic position/rotation sync.
- `IsServer`, `IsClient`, `IsOwner` checks to gate logic appropriately.

## Key AWS integration points

### GameLift Server SDK (in Unity headless server)

```csharp
// Lifecycle the server must implement:
// 1. InitSDK() — on server start
// 2. ProcessReady() — tell GameLift "I'm ready to host"
// 3. OnStartGameSession callback — GameLift assigns a match to this server
// 4. ActivateGameSession() — confirm the session is live
// 5. AcceptPlayerSession(playerSessionId) — validate each connecting player
// 6. RemovePlayerSession(playerSessionId) — when player disconnects
// 7. ProcessEnding() — when match ends, tell GameLift to recycle
```

### Lambda matchmaking flow

```typescript
// 1. Receive request with JWT from API Gateway (already validated by Cognito authorizer)
// 2. Extract player ID from JWT claims (event.requestContext.authorizer.claims.sub)
// 3. Call GameLiftClient.send(new StartMatchmakingCommand({
//      ConfigurationName: "...",
//      Players: [{ PlayerId, PlayerAttributes }]
//    }))
// 4. Poll or use SNS notification for match result
// 5. Return game session connection info (IP, port, player session ID) to client
```

## Getting started

1. Start with the **AWS infrastructure** (`cd aws-infra && npx cdk init app --language typescript`, then build stacks) — this can be developed and tested independently with `cdk synth` and `cdk deploy`.
2. Then write the **C# game scripts** — start with `TankController.cs` in singleplayer mode.
3. Add **networking** (NGO) — make tank movement sync between host and client.
4. Add **GameLift integration** — `GameLiftManager.cs` for the server SDK lifecycle.
5. Add **auth + matchmaking** — Lambda + Cognito + client-side `AuthClient.cs`.
6. Wire everything together and test end-to-end.

## References

- [Unity Netcode for GameObjects docs](https://docs-multiplayer.unity3d.com/netcode/current/about/)
- [GameLift Plugin for Unity (SDK 5.x)](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/unity-plug-in.html)
- [GameLift Server SDK integration guide](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/integration-engines-unity-using.html)
- [FlexMatch developer guide](https://docs.aws.amazon.com/gamelift/latest/flexmatchguide/match-intro.html)
- [AWS sample: amazon-gamelift-unity](https://github.com/aws-samples/amazon-gamelift-unity)
- [Tutorial: Building a Real-Time Multiplayer Game with Unity + GameLift (Bruffa)](https://betterprogramming.pub/building-a-real-time-multiplayer-game-with-unity3d-and-amazon-gamelift-228f706cfbec)
- [Code Monkey NGO course](https://unitycodemonkey.com/kitchenchaosmultiplayercourse.php)
- [Boss Room sample (production-level NGO)](https://github.com/Unity-Technologies/com.unity.multiplayer.samples.coop)
