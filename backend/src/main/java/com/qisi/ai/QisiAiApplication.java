package com.qisi.ai;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@MapperScan("com.qisi.ai.mapper")
@SpringBootApplication
public class QisiAiApplication {
    public static void main(String[] args) {
        SpringApplication.run(QisiAiApplication.class, args);
    }
}
