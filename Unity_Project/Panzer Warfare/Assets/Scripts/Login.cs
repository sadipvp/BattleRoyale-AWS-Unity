using UnityEngine;
using TMPro;
using UnityEngine.UI;

// 1. ESTA ES TU ESTRUCTURA DE DATOS (Limpia, sin MonoBehaviour)
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

        // 3. CREAMOS EL OBJETO USANDO LA CLASE LIMPIA
        LoginData dataParaEnviar = new LoginData();
        dataParaEnviar.username = userText;
        dataParaEnviar.password = passText;

        // 4. CONVERTIMOS A JSON
        string jsonData = JsonUtility.ToJson(dataParaEnviar);

        Debug.Log("JSON generado: " + jsonData); // Verifica que no salga {}

        NetworkManager.Instance.EnviarJson("http://localhost:8001/api/v1/login", jsonData);
    }
}