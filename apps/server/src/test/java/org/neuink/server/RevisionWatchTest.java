package org.neuink.server;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.neuink.server.persistence.RevisionWatchMapper;
import org.neuink.server.persistence.ServerIdentityMapper;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class RevisionWatchTest {
    @Test void duplicateWaitersShareReadAndSuccessfulCompletionReleasesCapacity() {
        var db=mock(RevisionWatchMapper.class);
        var identityDb=mock(ServerIdentityMapper.class);
        when(identityDb.readIdentity()).thenReturn(Map.of("id","server","epoch","epoch"));
        var watch=new RevisionWatch(db,new ServerIdentity(identityDb));
        var library="a".repeat(64);
        when(db.state(anyString(),anyString(),anyString(),anyString(),anyLong())).thenReturn(Map.of("id",library,"revision",0L,"minimum_revision",0L));
        var identity=new AuthService.Identity("user","session",false);
        for(int i=0;i<8;i++) assertFalse(watch.watch(identity,"Bearer token",library,"epoch",0,25000).hasResult());
        assertEquals(429,assertThrows(Api.Failure.class,()->watch.watch(identity,"Bearer token",library,"epoch",0,25000)).status);
        clearInvocations(db);watch.poll();
        verify(db,times(1)).state(anyString(),anyString(),anyString(),anyString(),anyLong());
        assertEquals(8,watch.waiting());
        when(db.state(anyString(),anyString(),anyString(),anyString(),anyLong())).thenReturn(Map.of("id",library,"revision",1L,"minimum_revision",0L));
        watch.poll();assertEquals(0,watch.waiting());watch.close();
    }
    @Test void closingCompletesWaitersAndRejectsNewWaits() {
        var db=mock(RevisionWatchMapper.class);var identityDb=mock(ServerIdentityMapper.class);
        when(identityDb.readIdentity()).thenReturn(Map.of("id","server","epoch","epoch"));
        var watch=new RevisionWatch(db,new ServerIdentity(identityDb));
        var library="a".repeat(64);var identity=new AuthService.Identity("user","session",false);
        when(db.state(anyString(),anyString(),anyString(),anyString(),anyLong())).thenReturn(Map.of("id",library,"revision",0L,"minimum_revision",0L));
        var pending=watch.watch(identity,"Bearer token",library,"epoch",0,25000);
        watch.close();assertEquals(0,watch.waiting());
        assertEquals(503,((Api.Failure)pending.getResult()).status);
        assertEquals(503,assertThrows(Api.Failure.class,()->watch.watch(identity,"Bearer token",library,"epoch",0,25000)).status);
    }
}
