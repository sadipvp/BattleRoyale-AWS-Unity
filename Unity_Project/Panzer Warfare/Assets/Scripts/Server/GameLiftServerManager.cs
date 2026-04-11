using UnityEngine;

// ============================================================================
// GameLift Server SDK Integration — SKELETON
// ============================================================================
// This script runs ONLY in the dedicated server build (headless Unity build
// uploaded to GameLift). It does NOT run in the client build.
//
// SETUP REQUIRED:
//   1. Download the GameLift Server SDK for C# from:
//      https://aws.amazon.com/gamelift/getting-started/
//   2. Extract the .dll files into Assets/Plugins/GameLift/
//   3. Uncomment the using / API calls below.
//
// HOW THE MOCK CONNECTS TO THIS:
//   Local:      mock matchmaking returns 127.0.0.1:7777
//               → you run this server build locally listening on 7777
//   AWS GameLift: FlexMatch provisions a fleet instance → calls onStartGameSession
//               → server calls ActivateGameSession → FlexMatch returns real IP:port
// ============================================================================

public class GameLiftServerManager : MonoBehaviour
{
    // Port the server listens on. GameLift passes this at process start.
    private int _listeningPort = 7777;

    void Start()
    {
        InitializeGameLift();
    }

    private void InitializeGameLift()
    {
        Debug.Log("[GameLiftServerManager] Initializing GameLift Server SDK...");

        // ---- UNCOMMENT AFTER ADDING THE SDK DLL ----
        //
        // var initOutcome = GameLiftServerAPI.InitSDK();
        // if (!initOutcome.Success)
        // {
        //     Debug.LogError("InitSDK failed: " + initOutcome.Error.ErrorMessage);
        //     Application.Quit(1);
        //     return;
        // }
        //
        // var processParams = new ProcessParameters(
        //     onStartGameSession: OnStartGameSession,
        //     onUpdateGameSession: OnUpdateGameSession,
        //     onProcessTerminate: OnProcessTerminate,
        //     onHealthCheck: OnHealthCheck,
        //     port: _listeningPort,
        //     logParameters: new LogParameters(new System.Collections.Generic.List<string>
        //     {
        //         "/local/game/logs/server.log"
        //     })
        // );
        //
        // var processReadyOutcome = GameLiftServerAPI.ProcessReady(processParams);
        // if (!processReadyOutcome.Success)
        // {
        //     Debug.LogError("ProcessReady failed: " + processReadyOutcome.Error.ErrorMessage);
        //     Application.Quit(1);
        //     return;
        // }
        //
        // Debug.Log("[GameLiftServerManager] Server ready on port " + _listeningPort);
    }

    // Called by GameLift when a game session is assigned to this server process
    private void OnStartGameSession(/* Aws.GameLift.Server.Model.GameSession gameSession */)
    {
        // GameLiftServerAPI.ActivateGameSession();
        Debug.Log("[GameLiftServerManager] Game session started.");
    }

    // Called when GameLift needs a fleet update (e.g., FlexMatch backfill)
    private void OnUpdateGameSession(/* Aws.GameLift.Server.Model.UpdateGameSession update */)
    {
        Debug.Log("[GameLiftServerManager] Game session updated.");
    }

    // Called when GameLift wants to terminate this process
    private void OnProcessTerminate()
    {
        // GameLiftServerAPI.ProcessEnding();
        Debug.Log("[GameLiftServerManager] Process terminating.");
        Application.Quit(0);
    }

    // Called periodically by GameLift to confirm the process is healthy
    private bool OnHealthCheck()
    {
        return true;
    }

    // Call this when a client connects. player_session_id comes from the client
    // (sent as part of the NGO ConnectionApproval payload).
    public void AcceptPlayerSession(string playerSessionId)
    {
        // var outcome = GameLiftServerAPI.AcceptPlayerSession(playerSessionId);
        // if (!outcome.Success)
        //     Debug.LogError("AcceptPlayerSession failed: " + outcome.Error.ErrorMessage);
        Debug.Log("[GameLiftServerManager] Accepted player session: " + playerSessionId);
    }

    // Call this when the match ends
    public void EndGame()
    {
        // GameLiftServerAPI.TerminateGameSession();
        Debug.Log("[GameLiftServerManager] Game session terminated.");
        Application.Quit(0);
    }

    void OnApplicationQuit()
    {
        // GameLiftServerAPI.Destroy();
    }
}
