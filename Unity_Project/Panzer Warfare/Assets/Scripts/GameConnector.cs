using UnityEngine;
using UnityEngine.UI;
using TMPro;
using Unity.Netcode;
using Unity.Netcode.Transports.UTP;

// Handles the HOST / JOIN connection UI in the Game scene.
//
// HOST  — starts an NGO server+client on port 7777. Use this on one machine.
// JOIN  — connects as a client to the IP:port received from matchmaking
//         (or 127.0.0.1:7777 if launched directly without matchmaking).
public class GameConnector : MonoBehaviour
{
    [SerializeField] private TMP_Text statusText;
    [SerializeField] private GameObject connectionPanel;
    [SerializeField] private Button hostButton;
    [SerializeField] private Button joinButton;

    private void Start()
    {
        hostButton.onClick.AddListener(StartHost);
        joinButton.onClick.AddListener(StartJoin);

        // Show where we would connect if coming from matchmaking
        if (GameSessionInfo.Instance != null)
            statusText.text = $"Match found: {GameSessionInfo.Instance.ServerIp}:{GameSessionInfo.Instance.ServerPort}";
        else
            statusText.text = "No matchmaking session — choose a mode below.";

        NetworkManager.Singleton.OnClientConnectedCallback    += OnConnected;
        NetworkManager.Singleton.OnClientDisconnectCallback   += OnDisconnected;
    }

    private void StartHost()
    {
        var transport = NetworkManager.Singleton.GetComponent<UnityTransport>();
        transport.SetConnectionData("127.0.0.1", 7777);

        NetworkManager.Singleton.StartHost();
        statusText.text = "Hosting on port 7777...";
        connectionPanel.SetActive(false);
        Debug.Log("[GameConnector] Started as Host on :7777");
    }

    private void StartJoin()
    {
        string ip   = GameSessionInfo.Instance?.ServerIp   ?? "127.0.0.1";
        ushort port = (ushort)(GameSessionInfo.Instance?.ServerPort ?? 7777);

        var transport = NetworkManager.Singleton.GetComponent<UnityTransport>();
        transport.SetConnectionData(ip, port);

        NetworkManager.Singleton.StartClient();
        statusText.text = $"Connecting to {ip}:{port}...";
        connectionPanel.SetActive(false);
        Debug.Log($"[GameConnector] Started as Client → {ip}:{port}");
    }

    private void OnConnected(ulong clientId)
    {
        if (clientId == NetworkManager.Singleton.LocalClientId)
            statusText.text = "Connected! WASD to drive.";
    }

    private void OnDisconnected(ulong clientId)
    {
        if (clientId == NetworkManager.Singleton.LocalClientId)
            statusText.text = "Disconnected.";
    }

    private void OnDestroy()
    {
        if (NetworkManager.Singleton == null) return;
        NetworkManager.Singleton.OnClientConnectedCallback  -= OnConnected;
        NetworkManager.Singleton.OnClientDisconnectCallback -= OnDisconnected;
    }
}
