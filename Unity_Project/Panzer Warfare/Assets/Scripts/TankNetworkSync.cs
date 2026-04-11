using UnityEngine;
using Unity.Netcode;

// Syncs tank position/rotation across the network using NetworkVariables.
// Owner (the player driving this tank) writes their position every frame.
// Non-owners smoothly interpolate to match.
// This replaces ClientNetworkTransform/NetworkTransform.
public class TankNetworkSync : NetworkBehaviour
{
    private NetworkVariable<Vector3> _netPosition = new NetworkVariable<Vector3>(
        default,
        NetworkVariableReadPermission.Everyone,
        NetworkVariableWritePermission.Owner
    );

    private NetworkVariable<Quaternion> _netRotation = new NetworkVariable<Quaternion>(
        Quaternion.identity,
        NetworkVariableReadPermission.Everyone,
        NetworkVariableWritePermission.Owner
    );

    private void Update()
    {
        if (IsOwner)
        {
            // Publish our current position for everyone else
            _netPosition.Value = transform.position;
            _netRotation.Value = transform.rotation;
        }
        else
        {
            // Smoothly follow the owner's reported position
            transform.position = Vector3.Lerp(transform.position, _netPosition.Value, Time.deltaTime * 15f);
            transform.rotation = Quaternion.Lerp(transform.rotation, _netRotation.Value, Time.deltaTime * 15f);
        }
    }
}
