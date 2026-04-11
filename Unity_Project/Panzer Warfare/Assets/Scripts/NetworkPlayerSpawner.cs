using UnityEngine;
using Unity.Netcode;

// Attach this to the NetworkManager GameObject in the Game scene.
// The server listens for player connections and spawns a tank for each one.
public class NetworkPlayerSpawner : MonoBehaviour
{
    [SerializeField] private NetworkObject tankPrefab;

    // Spawn positions — one per player slot
    private static readonly Vector3[] SpawnPoints =
    {
        new Vector3(-6f, 0.5f,  0f),
        new Vector3( 6f, 0.5f,  0f),
        new Vector3( 0f, 0.5f, -6f),
        new Vector3( 0f, 0.5f,  6f),
    };

    private void Start()
    {
        if (Unity.Netcode.NetworkManager.Singleton == null)
        {
            Debug.LogError("[NetworkPlayerSpawner] NetworkManager.Singleton is null — make sure NetworkManager is on the same GameObject.");
            return;
        }
        Unity.Netcode.NetworkManager.Singleton.OnClientConnectedCallback += OnClientConnected;
    }

    private void OnClientConnected(ulong clientId)
    {
        // Only the server spawns objects
        if (!Unity.Netcode.NetworkManager.Singleton.IsServer) return;

        Vector3 spawnPos = SpawnPoints[clientId % (ulong)SpawnPoints.Length];
        Debug.Log($"[NetworkPlayerSpawner] Spawning tank for client {clientId} at {spawnPos}");

        var tank = Instantiate(tankPrefab, spawnPos, Quaternion.identity);
        tank.SpawnAsPlayerObject(clientId, destroyWithScene: true);
    }

    private void OnDestroy()
    {
        if (Unity.Netcode.NetworkManager.Singleton != null)
            Unity.Netcode.NetworkManager.Singleton.OnClientConnectedCallback -= OnClientConnected;
    }
}
