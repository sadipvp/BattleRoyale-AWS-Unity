using UnityEngine;
using UnityEngine.Networking;
using System.Collections;
using System;

// HTTP client for backend services (auth, matchmaking).
// Renamed from NetworkManager to avoid conflict with Unity.Netcode.NetworkManager.
public class BackendClient : MonoBehaviour
{
    public static BackendClient Instance;

    // JWT token stored after login; persists across scenes via DontDestroyOnLoad
    public static string AuthToken = "";

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

    // POST with callback: callback(success, responseText)
    public void EnviarJson(string url, string jsonData, Action<bool, string> callback)
    {
        StartCoroutine(PostRequest(url, jsonData, callback));
    }

    // GET with Authorization: Bearer {AuthToken} header
    public void EnviarGetJson(string url, Action<bool, string> callback)
    {
        StartCoroutine(GetRequest(url, callback));
    }

    IEnumerator PostRequest(string url, string jsonData, Action<bool, string> callback)
    {
        using (UnityWebRequest request = new UnityWebRequest(url, "POST"))
        {
            byte[] bodyRaw = System.Text.Encoding.UTF8.GetBytes(jsonData);
            request.uploadHandler = new UploadHandlerRaw(bodyRaw);
            request.downloadHandler = new DownloadHandlerBuffer();
            request.SetRequestHeader("Content-Type", "application/json");

            if (!string.IsNullOrEmpty(AuthToken))
                request.SetRequestHeader("Authorization", "Bearer " + AuthToken);

            yield return request.SendWebRequest();

            bool success = request.result == UnityWebRequest.Result.Success;
            string responseText = request.downloadHandler.text;

            if (success) Debug.Log("Response: " + responseText);
            else         Debug.LogError("Error: " + request.error + " | " + responseText);

            callback?.Invoke(success, responseText);
        }
    }

    IEnumerator GetRequest(string url, Action<bool, string> callback)
    {
        using (UnityWebRequest request = UnityWebRequest.Get(url))
        {
            request.SetRequestHeader("Content-Type", "application/json");

            if (!string.IsNullOrEmpty(AuthToken))
                request.SetRequestHeader("Authorization", "Bearer " + AuthToken);

            yield return request.SendWebRequest();

            bool success = request.result == UnityWebRequest.Result.Success;
            string responseText = request.downloadHandler.text;

            if (success) Debug.Log("GET Response: " + responseText);
            else         Debug.LogError("GET Error: " + request.error + " | " + responseText);

            callback?.Invoke(success, responseText);
        }
    }
}
