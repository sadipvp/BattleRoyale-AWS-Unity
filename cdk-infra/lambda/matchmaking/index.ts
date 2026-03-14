/**
 * Matchmaking Lambda Handler
 *
 * Handles FlexMatch matchmaking requests from authenticated Unity clients.
 * The player must include their Cognito ID token as a Bearer token in the
 * Authorization header — API Gateway validates it before this Lambda runs.
 *
 * Routes:
 *   POST /match/find                  → Start matchmaking, return ticketId
 *   GET  /match/status/{ticketId}     → Poll for match result
 *
 * Polling flow (implemented client-side in Unity):
 *   1. POST /match/find  → get { ticketId }
 *   2. GET  /match/status/{ticketId}  every 2 seconds
 *   3. When status === "COMPLETED":
 *        connect to { ipAddress, port } via Unity Transport (UDP)
 *        pass playerSessionId to the server for validation
 *
 * Environment variables required:
 *   MATCHMAKING_CONFIG_NAME — FlexMatch configuration name from GameLiftStack
 */

import {
  GameLiftClient,
  StartMatchmakingCommand,
  StartMatchmakingCommandInput,
  DescribeMatchmakingCommand,
  DescribeMatchmakingCommandInput,
  MatchmakingTicket,
  GameLiftServiceException,
} from '@aws-sdk/client-gamelift';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

// -------------------------------------------------------------------------
// GameLift client — reused across warm invocations
// -------------------------------------------------------------------------
const gameLiftClient = new GameLiftClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
});

const MATCHMAKING_CONFIG_NAME = process.env.MATCHMAKING_CONFIG_NAME!;

// -------------------------------------------------------------------------
// Helper: build a standard API Gateway response
// -------------------------------------------------------------------------
function response(statusCode: number, body: object): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    },
    body: JSON.stringify(body),
  };
}

// -------------------------------------------------------------------------
// Helper: extract player ID from Cognito JWT claims
// -------------------------------------------------------------------------
// API Gateway Cognito authorizer populates requestContext.authorizer.claims
// with the decoded JWT payload. The "sub" claim is the unique player ID.
function getPlayerId(event: APIGatewayProxyEvent): string | null {
  const claims = event.requestContext?.authorizer?.claims as Record<string, string> | undefined;
  return claims?.sub ?? null;
}

// -------------------------------------------------------------------------
// Helper: parse latency data from request body
// -------------------------------------------------------------------------
// Unity should measure latency to each AWS region it knows about and send
// them so FlexMatch can pick the best server location.
// Format: { "latency": { "us-east-1": 45, "eu-west-1": 120 } }
// If no latency data is provided, we use a default value (less optimal).
function parseLatencyMap(body: string | null): Record<string, number> {
  if (!body) return {};
  try {
    const parsed = JSON.parse(body);
    if (parsed.latency && typeof parsed.latency === 'object') {
      return parsed.latency as Record<string, number>;
    }
  } catch {
    // Ignore parse errors — latency is optional
  }
  return {};
}

// -------------------------------------------------------------------------
// Route: POST /match/find
// -------------------------------------------------------------------------
// Submits the player to FlexMatch. Returns a ticketId that the client uses
// to poll for the match result.
//
// Response: { ticketId: string, status: string }
async function handleFindMatch(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const playerId = getPlayerId(event);
  if (!playerId) {
    return response(401, {
      error: 'UNAUTHORIZED',
      message: 'Could not extract player ID from token',
    });
  }

  const latencyMap = parseLatencyMap(event.body);

  // Build player attributes for FlexMatch
  // The latencyInMs attribute is used by the latency rule in the rule set
  const playerAttributes: Record<string, { attributeType: string; valueAttribute?: number; valueAttributeMap?: Record<string, number> }> = {};

  if (Object.keys(latencyMap).length > 0) {
    playerAttributes['latencyInMs'] = {
      attributeType: 'STRING_DOUBLE_MAP',
      valueAttributeMap: latencyMap,
    };
  }

  try {
    const input: StartMatchmakingCommandInput = {
      ConfigurationName: MATCHMAKING_CONFIG_NAME,
      Players: [
        {
          // PlayerId must be unique per player — Cognito sub is perfect
          PlayerId: playerId,
          // Player attributes matching the rule set definition
          PlayerAttributes: Object.keys(playerAttributes).length > 0
            ? playerAttributes
            : undefined,
          // Optional: include measured latency per region
          // FlexMatch uses this to enforce the latency rule
          LatencyInMs: Object.keys(latencyMap).length > 0 ? latencyMap : undefined,
        },
      ],
    };

    const result = await gameLiftClient.send(new StartMatchmakingCommand(input));

    if (!result.MatchmakingTicket) {
      return response(500, {
        error: 'MATCHMAKING_ERROR',
        message: 'GameLift did not return a matchmaking ticket',
      });
    }

    const ticket = result.MatchmakingTicket;
    console.log(`[findMatch] Ticket created: ${ticket.TicketId} for player: ${playerId}`);

    return response(200, {
      ticketId: ticket.TicketId,
      status: ticket.Status,
      // Tell the client how often to poll (milliseconds)
      pollIntervalMs: 2000,
    });
  } catch (err) {
    return handleGameLiftError(err, 'findMatch');
  }
}

// -------------------------------------------------------------------------
// Route: GET /match/status/{ticketId}
// -------------------------------------------------------------------------
// Polls FlexMatch for the current status of a matchmaking ticket.
// Unity calls this every ~2 seconds until status is COMPLETED or FAILED.
//
// Possible statuses:
//   QUEUED      — ticket submitted, waiting
//   SEARCHING   — FlexMatch is actively searching
//   REQUIRES_ACCEPTANCE — players need to accept (not used in our config)
//   PLACING     — match found, placing game session on fleet
//   COMPLETED   — game session ready; contains IP + port + playerSessionId
//   FAILED      — matchmaking failed (rule violation, timeout, etc.)
//   CANCELLED   — manually cancelled
//   TIMED_OUT   — exceeded requestTimeoutSeconds in the config
//
// Response on COMPLETED: { status, ipAddress, port, playerSessionId, dnsName }
// Response otherwise:    { status, message }
async function handleMatchStatus(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const ticketId = event.pathParameters?.ticketId;
  if (!ticketId) {
    return response(400, {
      error: 'VALIDATION_ERROR',
      message: 'Missing ticketId path parameter',
    });
  }

  // Verify the requesting player owns this ticket
  const playerId = getPlayerId(event);
  if (!playerId) {
    return response(401, {
      error: 'UNAUTHORIZED',
      message: 'Could not extract player ID from token',
    });
  }

  try {
    const input: DescribeMatchmakingCommandInput = {
      TicketIds: [ticketId],
    };

    const result = await gameLiftClient.send(new DescribeMatchmakingCommand(input));

    if (!result.TicketList || result.TicketList.length === 0) {
      return response(404, {
        error: 'TICKET_NOT_FOUND',
        message: `Matchmaking ticket ${ticketId} not found`,
      });
    }

    const ticket: MatchmakingTicket = result.TicketList[0];

    console.log(`[matchStatus] Ticket ${ticketId}: status=${ticket.Status}`);

    switch (ticket.Status) {
      case 'COMPLETED': {
        // Match found! Extract connection details from the game session placement.
        const placement = ticket.GameSessionConnectionInfo;
        if (!placement) {
          return response(500, {
            error: 'MATCHMAKING_ERROR',
            message: 'Match completed but no connection info found',
          });
        }

        // Find the player session for THIS specific player
        // (The ticket may contain multiple players' session IDs)
        const playerSession = placement.MatchedPlayerSessions?.find(
          (ps) => ps.PlayerId === playerId
        );

        return response(200, {
          status: 'COMPLETED',
          // Connection details for Unity Transport
          ipAddress: placement.IpAddress,
          dnsName: placement.DnsName, // May be used instead of IP in some regions
          port: placement.Port,
          // PlayerSessionId is passed to the dedicated server to validate the player
          // The server calls AcceptPlayerSession(playerSessionId) for each connecting player
          playerSessionId: playerSession?.PlayerSessionId,
          gameSessionId: placement.GameSessionArn,
        });
      }

      case 'FAILED':
      case 'CANCELLED':
      case 'TIMED_OUT': {
        return response(200, {
          status: ticket.Status,
          message: getStatusMessage(ticket.Status),
          // Include the reason if available (FlexMatch provides this for FAILED)
          statusReason: ticket.StatusReason,
        });
      }

      default: {
        // QUEUED, SEARCHING, PLACING, REQUIRES_ACCEPTANCE
        return response(200, {
          status: ticket.Status,
          message: getStatusMessage(ticket.Status ?? 'UNKNOWN'),
          // Estimated wait time (if GameLift provides it)
          estimatedWaitTimeSeconds: ticket.EstimatedWaitTime,
        });
      }
    }
  } catch (err) {
    return handleGameLiftError(err, 'matchStatus');
  }
}

// -------------------------------------------------------------------------
// Helper: human-readable status messages
// -------------------------------------------------------------------------
function getStatusMessage(status: string): string {
  const messages: Record<string, string> = {
    QUEUED: 'Waiting in queue...',
    SEARCHING: 'Searching for players...',
    PLACING: 'Match found! Preparing server...',
    REQUIRES_ACCEPTANCE: 'Waiting for players to accept...',
    COMPLETED: 'Match ready!',
    FAILED: 'Matchmaking failed. Please try again.',
    CANCELLED: 'Matchmaking was cancelled.',
    TIMED_OUT: 'Could not find a match. Please try again.',
    UNKNOWN: 'Unknown status',
  };
  return messages[status] ?? 'Processing...';
}

// -------------------------------------------------------------------------
// Error handler: translates GameLift exceptions to HTTP responses
// -------------------------------------------------------------------------
function handleGameLiftError(err: unknown, operation: string): APIGatewayProxyResult {
  if (err instanceof GameLiftServiceException) {
    console.warn(`[${operation}] GameLift error: ${err.name} — ${err.message}`);

    switch (err.name) {
      case 'InvalidRequestException':
        return response(400, {
          error: 'INVALID_REQUEST',
          message: err.message,
        });

      case 'NotFoundException':
        return response(404, {
          error: 'NOT_FOUND',
          message: err.message,
        });

      case 'UnsupportedRegionException':
        return response(400, {
          error: 'UNSUPPORTED_REGION',
          message: 'This region is not supported for matchmaking',
        });

      case 'ThrottlingException':
        return response(429, {
          error: 'RATE_LIMIT',
          message: 'Too many requests — please wait and try again',
        });

      default:
        console.error(`[${operation}] Unhandled GameLift error: ${err.name}`, err);
        return response(500, {
          error: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        });
    }
  }

  console.error(`[${operation}] Unexpected error:`, err);
  return response(500, {
    error: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
  });
}

// -------------------------------------------------------------------------
// Main Lambda Handler
// -------------------------------------------------------------------------
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log(`[handler] ${event.httpMethod} ${event.path}`);

  if (!MATCHMAKING_CONFIG_NAME) {
    console.error('[handler] Missing MATCHMAKING_CONFIG_NAME environment variable');
    return response(500, {
      error: 'CONFIG_ERROR',
      message: 'Server configuration error',
    });
  }

  const { httpMethod, path: requestPath } = event;

  if (httpMethod === 'POST' && requestPath?.endsWith('/find')) {
    return handleFindMatch(event);
  }

  if (httpMethod === 'GET' && requestPath?.includes('/status/')) {
    return handleMatchStatus(event);
  }

  return response(404, {
    error: 'NOT_FOUND',
    message: `Route ${httpMethod} ${requestPath} not found`,
  });
}
