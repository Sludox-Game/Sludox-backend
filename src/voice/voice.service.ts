import { Injectable, Logger } from '@nestjs/common';

export interface VoiceHealthStatus {
  status: 'healthy' | 'degraded';
  activeRooms: number;
  totalPeers: number;
  peakConcurrentPeers: number;
  meshDensity: number;
  signalsRelayed: {
    offers: number;
    answers: number;
    iceCandidates: number;
  };
  uptimeSeconds: number;
  timestamp: number;
}

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);
  private readonly startedAt = Date.now();

  /** Active peer connections per match: matchId -> Map<userId, Set<connectedPeerIds>> */
  private readonly peerConnections = new Map<
    string,
    Map<string, Set<string>>
  >();

  /** Connection metrics */
  private totalOffersRelayed = 0;
  private totalAnswersRelayed = 0;
  private totalIceCandidatesRelayed = 0;
  private peakConcurrentPeers = 0;

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

    const currentTotal = this.getTotalPeersCount();
    if (currentTotal > this.peakConcurrentPeers) {
      this.peakConcurrentPeers = currentTotal;
    }

    this.logger.log(
      `Peer ${userId} registered for voice in match ${matchId} (Room peers: ${matchPeers.size}, Total peers: ${currentTotal})`,
    );
  }

  /**
   * Record a relayed WebRTC signaling event for metrics.
   */
  recordSignal(type: 'offer' | 'answer' | 'ice'): void {
    if (type === 'offer') this.totalOffersRelayed++;
    else if (type === 'answer') this.totalAnswersRelayed++;
    else if (type === 'ice') this.totalIceCandidatesRelayed++;
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

  /**
   * Automatically clean up dangling voice rooms upon match conclusion (SG-B06).
   */
  cleanupMatchRoom(matchId: string): { cleanedRoom: boolean; peersDisconnected: number } {
    const matchPeers = this.peerConnections.get(matchId);
    if (!matchPeers) {
      return { cleanedRoom: false, peersDisconnected: 0 };
    }

    const peerCount = matchPeers.size;
    this.peerConnections.delete(matchId);

    this.logger.log(
      `Cleaned up dangling voice room for match ${matchId} (disconnected ${peerCount} peers)`,
    );

    return { cleanedRoom: true, peersDisconnected: peerCount };
  }

  /**
   * Total connected voice peers across all active match rooms.
   */
  getTotalPeersCount(): number {
    let count = 0;
    for (const room of this.peerConnections.values()) {
      count += room.size;
    }
    return count;
  }

  /**
   * Calculate WebRTC mesh density across active rooms.
   * Full mesh requires N*(N-1)/2 peer channels per room.
   */
  getMeshChannelCount(): number {
    let channels = 0;
    for (const room of this.peerConnections.values()) {
      const n = room.size;
      channels += (n * (n - 1)) / 2;
    }
    return channels;
  }

  /**
   * WebRTC signaling server health check and connection metrics (SG-B06).
   */
  getHealthStatus(): VoiceHealthStatus {
    const totalPeers = this.getTotalPeersCount();
    const activeRooms = this.peerConnections.size;
    const uptimeSeconds = Math.floor((Date.now() - this.startedAt) / 1000);

    return {
      status: 'healthy',
      activeRooms,
      totalPeers,
      peakConcurrentPeers: this.peakConcurrentPeers,
      meshDensity: this.getMeshChannelCount(),
      signalsRelayed: {
        offers: this.totalOffersRelayed,
        answers: this.totalAnswersRelayed,
        iceCandidates: this.totalIceCandidatesRelayed,
      },
      uptimeSeconds,
      timestamp: Date.now(),
    };
  }

  /**
   * Output structured metrics log.
   */
  logMetrics(): void {
    const health = this.getHealthStatus();
    this.logger.log(
      `[WebRTC Health Metrics] Rooms: ${health.activeRooms}, Peers: ${health.totalPeers}, Peak: ${health.peakConcurrentPeers}, Offers: ${health.signalsRelayed.offers}, Answers: ${health.signalsRelayed.answers}, ICE: ${health.signalsRelayed.iceCandidates}`,
    );
  }
}

