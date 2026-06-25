package com.digitaldemon.core.user;

import com.digitaldemon.core.user.User;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface UserRepository extends JpaRepository<User, UUID> {

    Optional<User> findByAuth0Sub(String auth0Sub);

    Optional<User> findByEmail(String email);

    Page<User> findByGlobalRole(String globalRole, Pageable pageable);

    @Query("SELECT u FROM User u WHERE " +
           "LOWER(u.email) LIKE LOWER(CONCAT('%', :search, '%')) OR " +
           "LOWER(u.displayName) LIKE LOWER(CONCAT('%', :search, '%'))")
    Page<User> searchByEmailOrDisplayName(String search, Pageable pageable);
}
