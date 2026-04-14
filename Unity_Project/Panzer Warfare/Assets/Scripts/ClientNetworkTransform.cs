using Unity.Netcode.Components;

// Overrides NetworkTransform to use owner authority instead of server authority.
// This means the client who owns the tank drives its position,
// and the server replicates it to all other clients.
// Attach this instead of NetworkTransform on any player-controlled NetworkObject.
[UnityEngine.DisallowMultipleComponent]
public class ClientNetworkTransform : NetworkTransform
{
    protected override bool OnIsServerAuthoritative() => false;
}
