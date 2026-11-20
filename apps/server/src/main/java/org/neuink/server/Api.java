package org.neuink.server;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.Map;
import org.bouncycastle.crypto.digests.Blake3Digest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

final class Api {
    private static final SecureRandom RANDOM = new SecureRandom();
    static long now() { return System.currentTimeMillis() / 1000; }
    static String token() { byte[] bytes = new byte[32]; RANDOM.nextBytes(bytes); return HexFormat.of().formatHex(bytes); }
    static String digest(String text) { return digest(text.getBytes(StandardCharsets.UTF_8)); }
    static String digest(byte[] bytes) {
        Blake3Digest digest = new Blake3Digest(); digest.update(bytes, 0, bytes.length);
        byte[] result = new byte[32]; digest.doFinal(result, 0);
        return HexFormat.of().formatHex(result);
    }
    static boolean hash(String value) { return value != null && value.matches("[0-9a-f]{64}"); }
    static String text(JsonNode body, String field, int maximum) {
        JsonNode value = body.get(field);
        if (value == null || !value.isTextual() || value.textValue().isBlank() || value.textValue().getBytes(StandardCharsets.UTF_8).length > maximum) throw fail(400, "invalid_" + field);
        return value.textValue();
    }
    static Failure fail(int status, String code) { return new Failure(status, code); }
    static final class Failure extends RuntimeException {
        final int status; final String code;
        Failure(int status, String code) { super(code); this.status = status; this.code = code; }
    }
}

@RestControllerAdvice
class ApiErrors {
    @ExceptionHandler(Api.Failure.class)
    ResponseEntity<?> known(Api.Failure failure) { return ResponseEntity.status(failure.status).body(Map.of("error", failure.code)); }
    @ExceptionHandler({org.springframework.http.converter.HttpMessageNotReadableException.class, org.springframework.web.bind.MissingServletRequestParameterException.class, org.springframework.web.method.annotation.MethodArgumentTypeMismatchException.class})
    ResponseEntity<?> invalid(Exception ignored) { return ResponseEntity.badRequest().body(Map.of("error", "invalid_request")); }
    @ExceptionHandler(Exception.class)
    ResponseEntity<?> unexpected(Exception ignored) { return ResponseEntity.internalServerError().body(Map.of("error", "request_failed")); }
}
