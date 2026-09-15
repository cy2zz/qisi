package com.qisi.ai.service;

import com.qisi.ai.domain.Question;
import com.qisi.ai.mapper.QuestionMapper;
import org.springframework.stereotype.Service;

@Service
public class QuestionService {
    private final QuestionMapper questionMapper;

    public QuestionService(QuestionMapper questionMapper) {
        this.questionMapper = questionMapper;
    }

    public Question getQuestion(Long id) {
        return questionMapper.findById(id);
    }
}
