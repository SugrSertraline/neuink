package org.neuink.server;

import java.net.InetAddress;
import org.apache.catalina.connector.Connector;
import org.apache.coyote.AbstractProtocol;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.web.embedded.tomcat.TomcatServletWebServerFactory;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Optional second connector for explicitly configured internal deployments. */
@Configuration
@ConditionalOnProperty(name = "neuink.http.enabled", havingValue = "true")
class InternalHttpConnector {
    @Bean
    WebServerFactoryCustomizer<TomcatServletWebServerFactory> internalHttp(
            @Value("${neuink.http.address:127.0.0.1}") String address,
            @Value("${neuink.http.port:8791}") int port) throws Exception {
        if (port < 1024 || port > 65535) throw new IllegalArgumentException("Invalid internal HTTP port");
        InetAddress bindAddress = InetAddress.getByName(address);
        return factory -> {
            Connector connector = new Connector("org.apache.coyote.http11.Http11NioProtocol");
            connector.setPort(port);
            ((AbstractProtocol<?>) connector.getProtocolHandler()).setAddress(bindAddress);
            factory.addAdditionalTomcatConnectors(connector);
        };
    }
}
