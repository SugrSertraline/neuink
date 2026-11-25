package org.neuink.server;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
class BlobController {
    private final BlobService blobs;
    BlobController(BlobService blobs) { this.blobs=blobs; }
    @PostMapping("/v1/uploads") Object create(Authentication principal,@RequestBody JsonNode request) { return blobs.create(AuthController.identity(principal).user(),request); }
    @GetMapping("/v1/uploads/{id}") Object status(Authentication principal,@PathVariable String id) { return blobs.status(AuthController.identity(principal).user(),id); }
    @PutMapping("/v1/uploads/{id}") Object chunk(Authentication principal,@PathVariable String id,@RequestParam long offset,@RequestBody byte[] bytes) { return blobs.chunk(AuthController.identity(principal).user(),id,offset,bytes); }
    @PostMapping("/v1/uploads/{id}/complete") Object complete(Authentication principal,@PathVariable String id) { return blobs.complete(AuthController.identity(principal).user(),id); }
    @DeleteMapping("/v1/uploads/{id}") Object cancel(Authentication principal,@PathVariable String id) { return blobs.cancel(AuthController.identity(principal).user(),id); }
    @GetMapping("/v1/blobs/{hash}") ResponseEntity<byte[]> download(Authentication principal,@PathVariable String hash,@RequestHeader(name="x-neuink-offset",required=false) String offset,@RequestHeader(name="Range",required=false) String range) {
        var file=blobs.download(AuthController.identity(principal).user(),hash,offset,range);
        var response=ResponseEntity.status(file.range()?206:200).header("Content-Type","application/octet-stream").header("x-neuink-size",Long.toString(file.size())).header("Accept-Ranges","bytes").header("Cache-Control","private, no-store");
        if(file.range()) response.header("Content-Range","bytes "+file.start()+"-"+file.end()+"/"+file.size());
        return response.body(file.content());
    }
}
