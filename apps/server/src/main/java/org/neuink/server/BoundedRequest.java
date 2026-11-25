package org.neuink.server;

import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import java.io.IOException;

/** Enforce the same cap for Content-Length and chunked requests before JSON allocation. */
final class BoundedRequest extends HttpServletRequestWrapper {
    private final ServletInputStream stream;
    BoundedRequest(HttpServletRequest request) throws IOException {
        super(request);
        ServletInputStream source=request.getInputStream();
        stream=new ServletInputStream() {
            long remaining=8L*1024*1024;
            private void count(int amount) throws IOException { if(amount>0 && (remaining-=amount)<0) throw new IOException("request_too_large"); }
            @Override public int read() throws IOException { int value=source.read(); count(value<0?0:1); return value; }
            @Override public int read(byte[] bytes,int offset,int length) throws IOException {
                int value=source.read(bytes,offset,(int)Math.min(length,remaining+1)); count(value); return value;
            }
            @Override public boolean isFinished() { return source.isFinished(); }
            @Override public boolean isReady() { return source.isReady(); }
            @Override public void setReadListener(ReadListener listener) { source.setReadListener(listener); }
            @Override public void close() throws IOException { source.close(); }
        };
    }
    @Override public ServletInputStream getInputStream() { return stream; }
}
