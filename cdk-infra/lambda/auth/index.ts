/**
 * Auth Lambda Handler
 *
 * Handles player registration and login by proxying requests to Cognito.
 * This exists because Unity clients can't use the Cognito Hosted UI (no browser)
 * and shouldn't hold long-lived AWS credentials.
 *
 * Routes:
 *   POST /auth/register  → SignUp (create new player account)
 *   POST /auth/login     → InitiateAuth (USER_PASSWORD_AUTH → return JWTs)
 *
 * Environment variables required:
 *   USER_POOL_ID        — Cognito User Pool ID (e.g. us-east-1_xxxxxxxxx)
 *   USER_POOL_CLIENT_ID — Cognito App Client ID (no secret)
 */

import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  SignUpCommandInput,
  InitiateAuthCommand,
  InitiateAuthCommandInput,
  AuthFlowType,
  CognitoIdentityProviderServiceException,
} from '@aws-sdk/client-cognito-identity-provider';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

// -------------------------------------------------------------------------
// Cognito client — reused across invocations (Lambda execution context reuse)
// -------------------------------------------------------------------------
const cognitoClient = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
});

// Read environment variables once at cold start
const USER_POOL_ID = process.env.USER_POOL_ID!;
const USER_POOL_CLIENT_ID = process.env.USER_POOL_CLIENT_ID!;

// -------------------------------------------------------------------------
// Helper: build a standard API Gateway response
// -------------------------------------------------------------------------
function response(statusCode: number, body: object): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      // CORS headers — allows Unity to call from any origin
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    },
    body: JSON.stringify(body),
  };
}

// -------------------------------------------------------------------------
// Helper: parse and validate request body
// -------------------------------------------------------------------------
function parseBody(event: APIGatewayProxyEvent): { email: string; password: string } | null {
  if (!event.body) return null;

  try {
    const parsed = JSON.parse(event.body);
    if (typeof parsed.email !== 'string' || typeof parsed.password !== 'string') {
      return null;
    }
    return { email: parsed.email.trim(), password: parsed.password };
  } catch {
    return null;
  }
}

// -------------------------------------------------------------------------
// Route: POST /auth/register
// -------------------------------------------------------------------------
// Creates a new player account in the Cognito User Pool.
// Response: { userId: string, message: string }
// Errors: 400 if validation fails, 409 if username already exists
async function handleRegister(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body) {
    return response(400, {
      error: 'VALIDATION_ERROR',
      message: 'Request body must contain "email" and "password" fields',
    });
  }

  const { email, password } = body;

  // Basic email format validation
  if (!email.includes('@')) {
    return response(400, {
      error: 'VALIDATION_ERROR',
      message: 'Invalid email address',
    });
  }

  // Password length check (Cognito will also validate against pool policy)
  if (password.length < 8) {
    return response(400, {
      error: 'VALIDATION_ERROR',
      message: 'Password must be at least 8 characters',
    });
  }

  try {
    const input: SignUpCommandInput = {
      ClientId: USER_POOL_CLIENT_ID,
      // Use email as the username (unique identifier in the pool)
      Username: email,
      Password: password,
      UserAttributes: [
        {
          // Cognito requires email to be set as an attribute even when used as username
          Name: 'email',
          Value: email,
        },
      ],
    };

    const result = await cognitoClient.send(new SignUpCommand(input));

    console.log(`[register] New player registered: ${result.UserSub}`);

    return response(200, {
      userId: result.UserSub,
      // For MVP: auto-confirm is handled by Cognito pool settings.
      // If confirmation is required, Unity needs to call /auth/confirm.
      message: 'Registration successful',
      // Let the client know if email confirmation is needed
      confirmed: result.UserConfirmed ?? false,
    });
  } catch (err) {
    return handleCognitoError(err, 'register');
  }
}

// -------------------------------------------------------------------------
// Route: POST /auth/login
// -------------------------------------------------------------------------
// Authenticates an existing player and returns JWT tokens.
// Unity uses the idToken (contains player claims like sub, email) to:
//   1. Authorize API Gateway requests (as Bearer token)
//   2. Pass to the matchmaking Lambda to identify the player
//
// Response: { accessToken, idToken, refreshToken, expiresIn }
async function handleLogin(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body) {
    return response(400, {
      error: 'VALIDATION_ERROR',
      message: 'Request body must contain "email" and "password" fields',
    });
  }

  const { email, password } = body;

  try {
    const input: InitiateAuthCommandInput = {
      AuthFlow: AuthFlowType.USER_PASSWORD_AUTH,
      ClientId: USER_POOL_CLIENT_ID,
      AuthParameters: {
        // USERNAME can be the email (since signInAliases.email = true in the pool)
        USERNAME: email,
        PASSWORD: password,
      },
    };

    const result = await cognitoClient.send(new InitiateAuthCommand(input));

    if (!result.AuthenticationResult) {
      // This shouldn't happen with USER_PASSWORD_AUTH unless MFA is required
      console.error('[login] No AuthenticationResult in Cognito response');
      return response(500, {
        error: 'AUTH_ERROR',
        message: 'Authentication failed — unexpected response from Cognito',
      });
    }

    const auth = result.AuthenticationResult;

    console.log(`[login] Player authenticated: ${email}`);

    return response(200, {
      // accessToken: used for Cognito API calls (e.g., ChangePassword)
      accessToken: auth.AccessToken,
      // idToken: use THIS as the Bearer token for API Gateway requests
      // It contains sub (userId), email, and other claims
      idToken: auth.IdToken,
      // refreshToken: use to get new access/id tokens when they expire
      // Store this securely — it's valid for 7 days
      refreshToken: auth.RefreshToken,
      // How long until access/id tokens expire (seconds, typically 3600)
      expiresIn: auth.ExpiresIn,
      tokenType: auth.TokenType,
    });
  } catch (err) {
    return handleCognitoError(err, 'login');
  }
}

// -------------------------------------------------------------------------
// Error handler: translates Cognito exceptions to HTTP responses
// -------------------------------------------------------------------------
function handleCognitoError(err: unknown, operation: string): APIGatewayProxyResult {
  if (err instanceof CognitoIdentityProviderServiceException) {
    console.warn(`[${operation}] Cognito error: ${err.name} — ${err.message}`);

    switch (err.name) {
      case 'UsernameExistsException':
        return response(409, {
          error: 'USER_EXISTS',
          message: 'An account with this email already exists',
        });

      case 'InvalidPasswordException':
        return response(400, {
          error: 'INVALID_PASSWORD',
          message: err.message, // Cognito provides a descriptive message
        });

      case 'NotAuthorizedException':
        // Wrong password or user doesn't exist (Cognito returns the same error for security)
        return response(401, {
          error: 'INVALID_CREDENTIALS',
          message: 'Incorrect email or password',
        });

      case 'UserNotFoundException':
        // Treat as invalid credentials to avoid user enumeration
        return response(401, {
          error: 'INVALID_CREDENTIALS',
          message: 'Incorrect email or password',
        });

      case 'UserNotConfirmedException':
        return response(403, {
          error: 'USER_NOT_CONFIRMED',
          message: 'Please confirm your email address before logging in',
        });

      case 'InvalidParameterException':
        return response(400, {
          error: 'VALIDATION_ERROR',
          message: err.message,
        });

      case 'TooManyRequestsException':
        return response(429, {
          error: 'RATE_LIMIT',
          message: 'Too many requests — please wait and try again',
        });

      default:
        console.error(`[${operation}] Unhandled Cognito error: ${err.name}`, err);
        return response(500, {
          error: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        });
    }
  }

  // Non-Cognito error (network issue, etc.)
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

  // Validate environment variables are set (fail fast on misconfiguration)
  if (!USER_POOL_ID || !USER_POOL_CLIENT_ID) {
    console.error('[handler] Missing required environment variables');
    return response(500, {
      error: 'CONFIG_ERROR',
      message: 'Server configuration error',
    });
  }

  // Route based on HTTP method + path
  const { httpMethod, path: requestPath } = event;

  if (httpMethod === 'POST' && requestPath?.endsWith('/register')) {
    return handleRegister(event);
  }

  if (httpMethod === 'POST' && requestPath?.endsWith('/login')) {
    return handleLogin(event);
  }

  // Unknown route — API Gateway should prevent this, but handle defensively
  return response(404, {
    error: 'NOT_FOUND',
    message: `Route ${httpMethod} ${requestPath} not found`,
  });
}
