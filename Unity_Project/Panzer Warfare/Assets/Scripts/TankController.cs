using UnityEngine;
using UnityEngine.InputSystem;
using Unity.Netcode;

// Works in two modes:
//   Solo (no NetworkObject): always accepts input, camera always follows.
//   Networked (has NetworkObject): only the owner accepts input and drives the camera.
[RequireComponent(typeof(Rigidbody))]
public class TankController : MonoBehaviour
{
    [SerializeField] private float moveSpeed = 8f;
    [SerializeField] private float turnSpeed = 120f;

    private Rigidbody _rb;
    private Camera _cam;
    private NetworkObject _netObj; // null when there is no NGO NetworkObject
    private bool _inputLogged;

    // True when playing solo OR when this is the local player's tank in a multiplayer session
    private bool IsLocalPlayer => _netObj == null || _netObj.IsOwner;

    void Awake()
    {
        _rb = GetComponent<Rigidbody>();
        _rb.freezeRotation = true;
        _netObj = GetComponent<NetworkObject>();
    }

    void Start()
    {
        _cam = Camera.main;
        // Log ownership state so we can diagnose movement issues
        if (_netObj != null)
            Debug.Log($"[TankController] Start — IsOwner={_netObj.IsOwner} IsLocalPlayer={IsLocalPlayer} ClientId={_netObj.OwnerClientId} IsKinematic={_rb.isKinematic}");
        else
            Debug.Log("[TankController] Start — Solo mode (no NetworkObject)");
    }

    void FixedUpdate()
    {
        if (!IsLocalPlayer) return;

        var keyboard = Keyboard.current;
        if (keyboard == null)
        {
            Debug.LogWarning("[TankController] Keyboard.current is NULL — Input System not initialized!");
            return;
        }

        float vertical = 0f;
        if (keyboard.wKey.isPressed || keyboard.upArrowKey.isPressed)   vertical =  1f;
        if (keyboard.sKey.isPressed || keyboard.downArrowKey.isPressed) vertical = -1f;

        float horizontal = 0f;
        if (keyboard.dKey.isPressed || keyboard.rightArrowKey.isPressed) horizontal =  1f;
        if (keyboard.aKey.isPressed || keyboard.leftArrowKey.isPressed)  horizontal = -1f;

        if (!_inputLogged && (Mathf.Abs(vertical) > 0.01f || Mathf.Abs(horizontal) > 0.01f))
        {
            Debug.Log($"[TankController] Input detected! v={vertical} h={horizontal} IsOwner={(_netObj != null ? _netObj.IsOwner.ToString() : "solo")}");
            _inputLogged = true;
        }

        if (Mathf.Abs(horizontal) > 0.01f)
            _rb.MoveRotation(_rb.rotation * Quaternion.Euler(0f, horizontal * turnSpeed * Time.fixedDeltaTime, 0f));

        if (Mathf.Abs(vertical) > 0.01f)
            _rb.MovePosition(_rb.position + transform.forward * vertical * moveSpeed * Time.fixedDeltaTime);
    }

    void LateUpdate()
    {
        if (!IsLocalPlayer) return;
        if (_cam == null) return;

        Vector3 desiredPos = transform.position + (-transform.forward * 8f) + Vector3.up * 4f;
        _cam.transform.position = Vector3.Lerp(_cam.transform.position, desiredPos, Time.deltaTime * 5f);
        _cam.transform.LookAt(transform.position + Vector3.up * 0.5f);
    }
}
