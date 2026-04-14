using UnityEngine;
using UnityEngine.UI;
using UnityEngine.SceneManagement;
using TMPro;
using System.Collections;

public class LobbyManager : MonoBehaviour
{
    [SerializeField] private Button findMatchButton;
    [SerializeField] private TMP_Text statusText;

    private const string JoinUrl = "http://localhost:8002/api/v1/join";
    private const string MatchStatusBaseUrl = "http://localhost:8002/api/v1/match-status/";
    private const float PollIntervalSeconds = 2f;

    [System.Serializable]
    private class JoinResponse { public string ticket_id; }

    [System.Serializable]
    private class MatchStatusResponse
    {
        public string status;
        public string ip;
        public int port;
        public string player_session_id;
    }

    void Start()
    {
        Debug.Log("[LobbyManager] Start — findMatchButton=" + (findMatchButton != null ? "OK" : "NULL") +
                  " | statusText=" + (statusText != null ? "OK" : "NULL") +
                  " | BackendClient.Instance=" + (BackendClient.Instance != null ? "OK" : "NULL"));

        if (findMatchButton == null) { Debug.LogError("[LobbyManager] findMatchButton is not assigned!"); return; }
        if (statusText == null)      { Debug.LogError("[LobbyManager] statusText is not assigned!"); return; }

        findMatchButton.onClick.AddListener(OnFindMatchClicked);
        statusText.text = "Welcome! Press Find Match to start.";
    }

    private void OnFindMatchClicked()
    {
        Debug.Log("[LobbyManager] Find Match clicked. Token=" + (BackendClient.AuthToken.Length > 10 ? "present" : "EMPTY"));

        if (BackendClient.Instance == null)
        {
            Debug.LogError("[LobbyManager] BackendClient.Instance is null — start from the Login scene!");
            statusText.text = "Error: start from the Login scene.";
            return;
        }

        findMatchButton.interactable = false;
        statusText.text = "Joining queue...";

        BackendClient.Instance.EnviarJson(JoinUrl, "{}", (success, response) =>
        {
            Debug.Log("[LobbyManager] /join response: success=" + success + " body=" + response);

            if (!success)
            {
                statusText.text = "Failed to join queue. Try again.";
                findMatchButton.interactable = true;
                return;
            }

            JoinResponse joined = JsonUtility.FromJson<JoinResponse>(response);
            Debug.Log("[LobbyManager] ticket_id=" + joined.ticket_id);
            statusText.text = "Searching for match...";
            StartCoroutine(PollMatchStatus(joined.ticket_id));
        });
    }

    private IEnumerator PollMatchStatus(string ticketId)
    {
        while (true)
        {
            yield return new WaitForSeconds(PollIntervalSeconds);

            bool responseReceived = false;
            bool pollSuccess = false;
            string pollResponse = "";

            BackendClient.Instance.EnviarGetJson(
                MatchStatusBaseUrl + ticketId,
                (success, response) =>
                {
                    pollSuccess = success;
                    pollResponse = response;
                    responseReceived = true;
                }
            );

            // Wait until the async callback fires
            yield return new WaitUntil(() => responseReceived);

            if (!pollSuccess)
            {
                Debug.LogWarning("Poll failed, retrying...");
                continue;
            }

            MatchStatusResponse matchStatus = JsonUtility.FromJson<MatchStatusResponse>(pollResponse);

            if (matchStatus.status == "ready")
            {
                // Store connection info for use in the Game scene
                if (GameSessionInfo.Instance == null)
                {
                    GameObject infoObj = new GameObject("GameSessionInfo");
                    infoObj.AddComponent<GameSessionInfo>();
                }

                GameSessionInfo.Instance.ServerIp = matchStatus.ip;
                GameSessionInfo.Instance.ServerPort = matchStatus.port;
                GameSessionInfo.Instance.PlayerSessionId = matchStatus.player_session_id;

                statusText.text = "Match found! Connecting...";
                SceneManager.LoadScene("Game");
                yield break;
            }
            else if (matchStatus.status == "failed")
            {
                statusText.text = "Matchmaking timed out. Try again.";
                findMatchButton.interactable = true;
                yield break;
            }
            else
            {
                // Still searching
                statusText.text = "Searching for match...";
            }
        }
    }
}
