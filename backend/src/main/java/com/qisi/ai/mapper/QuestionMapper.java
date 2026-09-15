package com.qisi.ai.mapper;

import com.qisi.ai.domain.Question;
import org.apache.ibatis.annotations.Select;

public interface QuestionMapper {
    @Select("SELECT id, source, concept, stem FROM question WHERE id = #{id}")
    Question findById(Long id);
}
