package org.neuink.server;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

@Component
class AdminCommand implements ApplicationRunner {
    private final AuthService auth; private final Environment environment; private final ConfigurableApplicationContext context;
    AdminCommand(AuthService auth,Environment environment,ConfigurableApplicationContext context) { this.auth=auth; this.environment=environment; this.context=context; }
    @Override public void run(ApplicationArguments arguments) {
        String command=environment.getProperty("neuink.command","");
        if(command.isEmpty()) return;
        try {
            switch(command) {
                case "create-admin" -> {
                    auth.createAdmin(environment.getRequiredProperty("NEUINK_ADMIN_USERNAME"),environment.getRequiredProperty("NEUINK_ADMIN_PASSWORD"));
                    System.out.println("Administrator created");
                }
                case "invite" -> System.out.println(auth.invite());
                default -> throw new IllegalArgumentException("Unsupported administrative command");
            }
        } finally { context.close(); }
    }
}
