import { Test, TestingModule } from '@nestjs/testing';
import { VoiceService } from './voice.service';

describe('VoiceService (SG-B06)', () => {
  let service: VoiceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [VoiceService],
    }).compile();

    service = module.get<VoiceService>(VoiceService);
  });

  describe('Peer Registration and Mesh Tracking', () => {
    it('should register peers in a match and calculate mesh channel count', () => {
      const matchId = 'match-v1';
      service.registerPeer(matchId, 'user-1');
      service.registerPeer(matchId, 'user-2');
      service.registerPeer(matchId, 'user-3');

      expect(service.getTotalPeersCount()).toBe(3);
      // Mesh channels for 3 peers = 3*(3-1)/2 = 3
      expect(service.getMeshChannelCount()).toBe(3);

      const peersForUser1 = service.getPeersInMatch(matchId, 'user-1');
      expect(peersForUser1).toEqual(['user-2', 'user-3']);
    });

    it('should record signaling metrics', () => {
      service.recordSignal('offer');
      service.recordSignal('offer');
      service.recordSignal('answer');
      service.recordSignal('ice');

      const health = service.getHealthStatus();
      expect(health.signalsRelayed.offers).toBe(2);
      expect(health.signalsRelayed.answers).toBe(1);
      expect(health.signalsRelayed.iceCandidates).toBe(1);
      expect(health.status).toBe('healthy');
    });
  });

  describe('Dangling Room Cleanup on Match Conclusion', () => {
    it('should clean up dangling voice rooms and disconnect peers when match ends', () => {
      const matchId = 'match-cleanup-1';
      service.registerPeer(matchId, 'peer-a');
      service.registerPeer(matchId, 'peer-b');
      service.registerPeer(matchId, 'peer-c');
      service.registerPeer(matchId, 'peer-d');

      expect(service.getTotalPeersCount()).toBe(4);

      const cleanup = service.cleanupMatchRoom(matchId);
      expect(cleanup.cleanedRoom).toBe(true);
      expect(cleanup.peersDisconnected).toBe(4);

      expect(service.getTotalPeersCount()).toBe(0);
      expect(service.getPeersInMatch(matchId, 'peer-a')).toEqual([]);
    });

    it('should return false when cleaning up non-existent room', () => {
      const cleanup = service.cleanupMatchRoom('non-existent');
      expect(cleanup.cleanedRoom).toBe(false);
      expect(cleanup.peersDisconnected).toBe(0);
    });
  });
});
