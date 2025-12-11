package signaling

import (
	"context"
	"fmt"
	"strings"

	"github.com/redis/go-redis/v9"
)

// PresenceStore abstracts presence + broadcast tracking so callers can swap storage backends.
type PresenceStore interface {
	Reset(ctx context.Context) error
	AddPeer(ctx context.Context, id string) error
	RemovePeer(ctx context.Context, id string) error
	SetBroadcast(ctx context.Context, id string, enabled bool) error
	State(ctx context.Context) (peers []string, broadcasting []string, err error)
}

// RedisPresence implements PresenceStore using Redis sets.
type RedisPresence struct {
	rdb           *redis.Client
	keyPeers      string
	keyBroadcasts string
}

// NewRedisPresence builds a PresenceStore backed by Redis. Prefix is optional (e.g., "webrtc").
func NewRedisPresence(rdb *redis.Client, prefix string) *RedisPresence {
	p := strings.TrimSuffix(strings.TrimSpace(prefix), ":")
	if p == "" {
		p = "webrtc"
	}
	return &RedisPresence{
		rdb:           rdb,
		keyPeers:      fmt.Sprintf("%s:peers", p),
		keyBroadcasts: fmt.Sprintf("%s:broadcasting", p),
	}
}

func (s *RedisPresence) Reset(ctx context.Context) error {
	return s.rdb.Del(ctx, s.keyPeers, s.keyBroadcasts).Err()
}

func (s *RedisPresence) AddPeer(ctx context.Context, id string) error {
	return s.rdb.SAdd(ctx, s.keyPeers, id).Err()
}

func (s *RedisPresence) RemovePeer(ctx context.Context, id string) error {
	pipe := s.rdb.TxPipeline()
	_ = pipe.SRem(ctx, s.keyPeers, id)
	_ = pipe.SRem(ctx, s.keyBroadcasts, id)
	_, err := pipe.Exec(ctx)
	return err
}

func (s *RedisPresence) SetBroadcast(ctx context.Context, id string, enabled bool) error {
	if enabled {
		return s.rdb.SAdd(ctx, s.keyBroadcasts, id).Err()
	}
	return s.rdb.SRem(ctx, s.keyBroadcasts, id).Err()
}

func (s *RedisPresence) State(ctx context.Context) ([]string, []string, error) {
	pipe := s.rdb.Pipeline()
	peersCmd := pipe.SMembers(ctx, s.keyPeers)
	broadcastCmd := pipe.SMembers(ctx, s.keyBroadcasts)
	if _, err := pipe.Exec(ctx); err != nil {
		return nil, nil, err
	}
	return peersCmd.Val(), broadcastCmd.Val(), nil
}
