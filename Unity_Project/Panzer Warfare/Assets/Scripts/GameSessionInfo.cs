using UnityEngine;

// Holds game server connection info between scenes.
// Created in the Lobby scene; survives scene loads via DontDestroyOnLoad.
public class GameSessionInfo : MonoBehaviour
{
    public static GameSessionInfo Instance;

    public string ServerIp;
    public int ServerPort;
    public string PlayerSessionId;

    void Awake()
    {
        if (Instance == null)
        {
            Instance = this;
            DontDestroyOnLoad(gameObject);
        }
        else
        {
            Destroy(gameObject);
        }
    }
}
