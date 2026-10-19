/** What's needed to resume a signed-in session without asking for the password again. */
export interface Session {
  serverUrl: string;
  serverName: string;
  accessToken: string;
  userId: string;
  userName: string;
  /** Tag of the user's avatar on the server; absent when the user has none. */
  imageTag?: string;
}
