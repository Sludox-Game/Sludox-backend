import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);

  /** Active peer connections per match */
  private readonly peerConnections = new Map<
    string,
    Map<string, Set<string>>
  >();

  /**
   * Register a peer in a match for voice.
   */
  registerPeer(matchId: string, userId: string): void {
    if (!this.peerConnections.has(matchId)) {
      this.peerConnections.set(matchId, new Map());
    }
    const matchPeers = this.peerConnections.get(matchId)!;
    if (!matchPeers.has(userId)) {
      matchPeers.set(userId, new Set());
    }
    this.logger.log(`Peer ${userId} registered for voice in match ${matchId}`);
  }

  /**
   * Get all peers in a match except the sender.
   */
  getPeersInMatch(matchId: string, excludeUserId: string): string[] {
    const matchPeers = this.peerConnections.get(matchId);
    if (!matchPeers) return [];
    return Array.from(matchPeers.keys()).filter((id) => id !== excludeUserId);
  }

  /**
   * Remove a peer from a match.
   */
  removePeer(matchId: string, userId: string): void {
    const matchPeers = this.peerConnections.get(matchId);
    if (matchPeers) {
      matchPeers.delete(userId);
      if (matchPeers.size === 0) {
        this.peerConnections.delete(matchId);
      }
    }
    this.logger.log(`Peer ${userId} removed from voice in match ${matchId}`);
  }
}
