package org.neuink.server;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.ByteArrayInputStream;
import java.util.Base64;
import javax.imageio.ImageIO;

/** Avatars are small self-contained PNGs; no remote URLs or active image formats. */
final class ProfileAvatar {
    static String validate(JsonNode value) {
        if (!value.isTextual()) throw Api.fail(400,"invalid_avatar");
        String text=value.textValue();
        if(text.isEmpty()) return text;
        String prefix="data:image/png;base64,";
        if(!text.startsWith(prefix) || text.length()>360000) throw Api.fail(400,"invalid_avatar");
        try {
            byte[] bytes=Base64.getDecoder().decode(text.substring(prefix.length()));
            if(bytes.length>262144) throw new IllegalArgumentException();
            try(var input=ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
                var readers=ImageIO.getImageReaders(input);
                if(!readers.hasNext()) throw new IllegalArgumentException();
                var reader=readers.next();
                try {
                    reader.setInput(input);
                    if(!reader.getFormatName().equalsIgnoreCase("png") || reader.getWidth(0)<1 || reader.getHeight(0)<1 || reader.getWidth(0)>256 || reader.getHeight(0)>256) throw new IllegalArgumentException();
                    if(reader.read(0)==null) throw new IllegalArgumentException();
                } finally { reader.dispose(); }
            }
            return prefix+Base64.getEncoder().encodeToString(bytes);
        } catch(Exception ignored) { throw Api.fail(400,"invalid_avatar"); }
    }
}
