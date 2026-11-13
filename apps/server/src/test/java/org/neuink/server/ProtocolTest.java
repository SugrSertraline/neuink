package org.neuink.server;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ProtocolTest {
    @Test void digestMatchesPublishedBlake3Vector() {
        assertEquals("af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262",Api.digest(""));
    }
    @Test void operationSerializationKeepsRustFieldOrderAndCanonicalContent() throws Exception {
        ObjectMapper json=new ObjectMapper();
        var op=json.readTree("{\"kind\":\"note\",\"object_id\":\"n\",\"operation_id\":\"op\",\"mutation\":{\"content\":{\"z\":1,\"a\":2},\"action\":\"put\"}}");
        assertEquals("{\"operation_id\":\"op\",\"object_id\":\"n\",\"kind\":\"note\",\"base_revision\":null,\"mutation\":{\"action\":\"put\",\"content\":{\"a\":2,\"z\":1}}}",new SyncService(null,null,null,json,null).canonicalOperation(op));
    }
}
