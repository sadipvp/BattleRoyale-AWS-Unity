using UnityEngine;
using UnityEngine.SceneManagement;
using TMPro;
using UnityEngine.UI;

[System.Serializable]
public class LoginData
{
    public string username;
    public string password;
}

public class Login : MonoBehaviour
{
    [SerializeField] private TMP_InputField usernameInput;
    [SerializeField] private TMP_InputField passwordInput;
    [SerializeField] private Button loginButton;
    [SerializeField] private TMP_Text feedbackText;

    [System.Serializable]
    private class LoginResponse { public string token; }

    private void Awake()
    {
        loginButton.onClick.AddListener(OnLoginButtonClicked);
    }

    private void OnLoginButtonClicked()
    {
        string userText = usernameInput.text;
        string passText = passwordInput.text;

        if (string.IsNullOrEmpty(userText) || string.IsNullOrEmpty(passText))
        {
            feedbackText.text = "Please enter both username and password.";
            return;
        }

        loginButton.interactable = false;
        feedbackText.text = "Logging in...";

        LoginData dataParaEnviar = new LoginData();
        dataParaEnviar.username = userText;
        dataParaEnviar.password = passText;

        string jsonData = JsonUtility.ToJson(dataParaEnviar);

        BackendClient.Instance.EnviarJson(
            "http://localhost:8001/api/v1/login",
            jsonData,
            (success, response) =>
            {
                if (success)
                {
                    LoginResponse parsed = JsonUtility.FromJson<LoginResponse>(response);
                    BackendClient.AuthToken = parsed.token;
                    SceneManager.LoadScene("Lobby");
                }
                else
                {
                    feedbackText.text = "Login failed. Check your credentials.";
                    loginButton.interactable = true;
                }
            }
        );
    }
}